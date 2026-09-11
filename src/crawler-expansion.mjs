import { TURN_QUIESCENT_REQUIRED_ROUNDS } from './crawler-disclosure-state.mjs';

const DISCLOSURE_STABLE_SAMPLES = 3;
const DISCLOSURE_SAMPLE_INTERVAL_MS = 120;
const DISCLOSURE_MAX_SETTLE_MS = 3600;
const TURN_QUIESCENT_ROUND_INTERVAL_MS = 180;
const TURN_QUIESCENT_MAX_WAIT_MS = 8000;
const IDLE_DISCLOSURE_REQUIRED_ROUNDS = 2;
const IDLE_STALLED_ACTIONABLE_REQUIRED_ROUNDS = TURN_QUIESCENT_REQUIRED_ROUNDS;
const IDLE_DISCLOSURE_ROUND_INTERVAL_MS = 180;

async function report(page, onProgress) {
  if (!onProgress) return;
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  await onProgress({ ...stats, scrollTop: metrics.top, scrollHeight: metrics.height, scrollClient: metrics.client });
}

async function captureActiveTurn(page, turnId) {
  if (!turnId) return page.evaluate(() => window.__archiveCrawler.capture());
  return page.evaluate(id => window.__archiveCrawler.captureTurn(id), turnId);
}

async function turnRevision(page, turnId) {
  if (!turnId) return 0;
  return page.evaluate(id => Number(
    window.__archiveCrawler.turnRevision?.(id)
    ?? window.__archiveCrawler.state?.turnRevisions?.[id]
    ?? 0
  ), turnId);
}

function semanticTurnSignature(sample, revision) {
  return [
    Number(revision || 0),
    Number(sample?.actionableCollapsed || 0),
    ...(Array.isArray(sample?.actionableLogicalKeys) ? sample.actionableLogicalKeys : [])
  ].join('|');
}

function semanticMountedSignature(sample) {
  return [
    Number(sample?.actionableCollapsed || 0),
    ...(Array.isArray(sample?.actionableLogicalKeys) ? sample.actionableLogicalKeys : [])
  ].join('|');
}

async function expandOneWithRevision(page, turnId) {
  return page.evaluate(scopeTurnId => {
    const crawler = window.__archiveCrawler;
    const result = crawler.expandOne(scopeTurnId);
    if (!result) return { result: null, turnRevisionBefore: scopeTurnId ? Number(crawler.turnRevision?.(scopeTurnId) || 0) : 0 };
    return {
      result,
      turnRevisionBefore: Number(result.turnRevisionBefore ?? crawler.turnRevision?.(result.turnId) ?? 0)
    };
  }, turnId);
}

async function waitForDisclosureHydration(page, result, shouldCancel) {
  if (!result?.key) return null;
  const deadline = Date.now() + DISCLOSURE_MAX_SETTLE_MS;
  let previousSignature = '';
  let stableSamples = 0;
  let latest = null;

  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    latest = await page.evaluate(key => window.__archiveCrawler.disclosureSample(key), result.key);
    if (latest.expanded && latest.targetExists) {
      stableSamples = latest.signature === previousSignature ? stableSamples + 1 : 1;
      previousSignature = latest.signature;
      if (stableSamples >= DISCLOSURE_STABLE_SAMPLES) return latest;
    } else {
      stableSamples = 0;
      previousSignature = '';
    }
    await page.waitForTimeout(DISCLOSURE_SAMPLE_INTERVAL_MS);
  }
  if (latest) return { ...latest, timedOut: true };
  return { present: false, expanded: false, targetExists: false, turnId: result.turnId || '', signature: 'timeout', timedOut: true };
}

async function processExpansion(page, result, turnRevisionBefore, onProgress, shouldCancel) {
  await page.evaluate(turnId => window.__archiveCrawler.noteExpansionGeneration(turnId), result.turnId || '');
  let confirmed = result.kind === 'details';
  if (result.kind === 'details') {
    await page.waitForTimeout(80);
  } else {
    const hydration = await waitForDisclosureHydration(page, result, shouldCancel);
    if (hydration?.timedOut) {
      await page.evaluate(value => window.__archiveCrawler.noteHydrationTimeout?.(value), {
        turnId: result.turnId || hydration.turnId || '',
        key: result.key || '',
        kind: 'disclosure-hydration',
        waitMs: DISCLOSURE_MAX_SETTLE_MS
      });
    }
    confirmed = await page.evaluate(key => {
      const crawler = window.__archiveCrawler;
      crawler.confirm(key);
      return !Object.prototype.hasOwnProperty.call(crawler.state?.attempts || {}, key);
    }, result.key);
  }

  const activity = await captureActiveTurn(page, result.turnId || '');
  const revisionAfter = await turnRevision(page, result.turnId || '');
  const retainedProgress = revisionAfter > Number(turnRevisionBefore || 0);

  // A successful activation can produce a richer retained turn and then remount
  // collapsed once more. Record semantic completion only when an activation
  // produces no newer retained generation. If it improved the turn, leave
  // it eligible for one more verification at the new revision.
  if (confirmed && !retainedProgress && result.logicalKey && result.turnId) {
    await page.evaluate(value => window.__archiveCrawler.markDisclosureComplete?.(value), {
      logicalKey: result.logicalKey,
      turnId: result.turnId
    });
  }

  await onProgress?.({
    ...activity,
    expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
  });
  return { confirmed, revisionAfter, retainedProgress };
}

async function markTurnQuiescence(page, turnId, quietRounds, signature, converged, timedOut = false) {
  await page.evaluate(value => window.__archiveCrawler.markQuiescence(value), {
    rounds: quietRounds,
    requiredRounds: TURN_QUIESCENT_REQUIRED_ROUNDS,
    lastSignature: signature,
    converged,
    scopeTurnId: turnId,
    timedOut
  });
}

/**
 * Expand disclosures while semantic archive progress is being made. When a
 * scope turn is supplied, no neighboring mounted turn can steal the expansion
 * loop; this is the primitive used by turn-by-turn processing/reconciliation.
 */
async function expandScope(page, max, onProgress, shouldCancel, scopeTurnId = '') {
  const fixedScopeTurnId = String(scopeTurnId || '');
  let processed = 0;
  let reportCounter = 0;
  let activeTurnId = fixedScopeTurnId;
  let quietRounds = 0;
  let previousTurnSignature = '';
  let lastSemanticProgressAt = Date.now();
  let lastObservedTurnRevision = fixedScopeTurnId ? await turnRevision(page, fixedScopeTurnId) : 0;
  let idleRounds = 0;
  let previousIdleSignature = '';
  let idleStartedAt = Date.now();
  let exitReason = 'fixed-point';
  let timedOut = false;

  while (processed < max) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    const requestedTurnId = fixedScopeTurnId || activeTurnId;
    const { result, turnRevisionBefore } = await expandOneWithRevision(page, requestedTurnId);
    if (result) {
      if (fixedScopeTurnId && result.turnId && result.turnId !== fixedScopeTurnId) {
        throw new Error(`Scoped disclosure expansion escaped ${fixedScopeTurnId} into ${result.turnId}.`);
      }
      if (result.turnId && result.turnId !== activeTurnId) {
        activeTurnId = result.turnId;
        lastObservedTurnRevision = Number(turnRevisionBefore || 0);
      } else {
        activeTurnId = result.turnId || activeTurnId || fixedScopeTurnId;
      }

      const expansion = await processExpansion(
        page,
        result,
        turnRevisionBefore,
        onProgress,
        shouldCancel
      );

      processed++;
      reportCounter++;
      lastObservedTurnRevision = Math.max(lastObservedTurnRevision, expansion.revisionAfter);
      idleRounds = 0;
      previousIdleSignature = '';
      idleStartedAt = Date.now();

      if (expansion.confirmed || expansion.retainedProgress) lastSemanticProgressAt = Date.now();

      quietRounds = 0;
      previousTurnSignature = '';
      await markTurnQuiescence(page, activeTurnId, 0, '', false, false);

      if (reportCounter >= 8) {
        await report(page, onProgress);
        reportCounter = 0;
      }
      continue;
    }

    if (!activeTurnId) {
      const sample = await page.evaluate(() => window.__archiveCrawler.mountedDisclosureSample());
      const signature = semanticMountedSignature(sample);
      idleRounds = signature === previousIdleSignature ? idleRounds + 1 : 1;
      previousIdleSignature = signature;

      const requiredRounds = sample.actionableCollapsed > 0
        ? IDLE_STALLED_ACTIONABLE_REQUIRED_ROUNDS
        : IDLE_DISCLOSURE_REQUIRED_ROUNDS;
      const idleTimedOut = Date.now() - idleStartedAt >= TURN_QUIESCENT_MAX_WAIT_MS;
      if (idleRounds >= requiredRounds) {
        exitReason = sample.actionableCollapsed > 0 ? 'semantic-stall' : 'fixed-point';
        break;
      }
      if (idleTimedOut) {
        timedOut = true;
        exitReason = 'mounted-quiescence-timeout';
        await page.evaluate(value => window.__archiveCrawler.noteHydrationTimeout?.(value), {
          turnId: '',
          kind: 'mounted-quiescence',
          waitMs: TURN_QUIESCENT_MAX_WAIT_MS,
          actionableCollapsed: Number(sample.actionableCollapsed || 0)
        });
        break;
      }

      await page.waitForTimeout(sample.actionableCollapsed > 0 ? 20 : IDLE_DISCLOSURE_ROUND_INTERVAL_MS);
      continue;
    }

    await captureActiveTurn(page, activeTurnId);
    const revisionAfterCapture = await turnRevision(page, activeTurnId);
    if (revisionAfterCapture > lastObservedTurnRevision) {
      lastObservedTurnRevision = revisionAfterCapture;
      lastSemanticProgressAt = Date.now();
      quietRounds = 0;
      previousTurnSignature = '';
    }

    const sample = await page.evaluate(turnId => window.__archiveCrawler.turnDisclosureSample(turnId), activeTurnId);
    if (!sample.mounted) {
      await markTurnQuiescence(page, activeTurnId, quietRounds, `missing:${activeTurnId}`, false, false);
      if (fixedScopeTurnId) {
        exitReason = 'scope-unmounted';
        break;
      }
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
      lastObservedTurnRevision = 0;
      continue;
    }

    const signature = semanticTurnSignature(sample, revisionAfterCapture);
    quietRounds = signature === previousTurnSignature ? quietRounds + 1 : 1;
    previousTurnSignature = signature;
    const turnTimedOut = Date.now() - lastSemanticProgressAt >= TURN_QUIESCENT_MAX_WAIT_MS;
    const converged = quietRounds >= TURN_QUIESCENT_REQUIRED_ROUNDS;
    await markTurnQuiescence(page, activeTurnId, quietRounds, signature, converged, turnTimedOut);

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    await onProgress?.({
      ...stats,
      expandingStatus: converged
        ? sample.actionableCollapsed > 0
          ? `${activeTurnId} semantic stall · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} unchanged rounds with ${sample.actionableCollapsed} actionable; yielding`
          : `${activeTurnId} semantic disclosure fixed point · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds`
        : turnTimedOut
          ? `${activeTurnId} semantic progress wait hit ${TURN_QUIESCENT_MAX_WAIT_MS / 1000}s safety limit`
          : `Waiting for semantic disclosure progress in ${activeTurnId} · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds · actionable ${sample.actionableCollapsed}`
    });

    if (turnTimedOut) {
      timedOut = true;
      await page.evaluate(value => window.__archiveCrawler.noteHydrationTimeout?.(value), {
        turnId: activeTurnId,
        kind: 'turn-quiescence',
        waitMs: TURN_QUIESCENT_MAX_WAIT_MS,
        actionableCollapsed: Number(sample.actionableCollapsed || 0)
      });
    }

    if (converged || turnTimedOut) {
      if (fixedScopeTurnId) {
        exitReason = converged && sample.actionableCollapsed === 0 ? 'fixed-point' : turnTimedOut ? 'turn-quiescence-timeout' : 'semantic-stall';
        break;
      }
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
      lastObservedTurnRevision = 0;
      idleRounds = 0;
      previousIdleSignature = '';
      idleStartedAt = Date.now();
      continue;
    }
    await page.waitForTimeout(sample.actionableCollapsed > 0 ? 20 : TURN_QUIESCENT_ROUND_INTERVAL_MS);
  }

  const hitActionLimit = processed >= max;
  if (hitActionLimit) {
    exitReason = 'action-limit';
    await page.evaluate(value => window.__archiveCrawler.noteExpansionLimit?.(value), {
      processed,
      limit: max,
      scopeTurnId: fixedScopeTurnId || activeTurnId || '',
      reason: exitReason
    });
  }

  if (reportCounter) await report(page, onProgress);
  return {
    converged: exitReason === 'fixed-point' && !hitActionLimit && !timedOut,
    processed,
    limit: max,
    reason: exitReason,
    timedOut,
    scopeTurnId: fixedScopeTurnId
  };
}

export async function expandMounted(page, max, onProgress, shouldCancel) {
  return expandScope(page, max, onProgress, shouldCancel, '');
}

export async function expandTurn(page, turnId, max, onProgress, shouldCancel) {
  if (!turnId) throw new Error('expandTurn requires a retained turn id.');
  return expandScope(page, max, onProgress, shouldCancel, turnId);
}
