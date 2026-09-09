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

export async function waitForDisclosureHydration(page, result, shouldCancel) {
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
  return latest;
}

async function processExpansion(page, result, turnRevisionBefore, onProgress, shouldCancel) {
  await page.evaluate(turnId => window.__archiveCrawler.noteExpansionGeneration(turnId), result.turnId || '');
  let confirmed = result.kind === 'details';
  if (result.kind === 'details') {
    await page.waitForTimeout(80);
  } else {
    await waitForDisclosureHydration(page, result, shouldCancel);
    confirmed = await page.evaluate(key => {
      const crawler = window.__archiveCrawler;
      crawler.confirm(key);
      return !Object.prototype.hasOwnProperty.call(crawler.state?.attempts || {}, key);
    }, result.key);
  }

  const activity = await captureActiveTurn(page, result.turnId || '');
  const revisionAfter = await turnRevision(page, result.turnId || '');
  if (confirmed && result.logicalKey && result.turnId) {
    await page.evaluate(value => window.__archiveCrawler.markDisclosureComplete?.(value), {
      logicalKey: result.logicalKey,
      turnId: result.turnId
    });
  }

  await onProgress?.({
    ...activity,
    expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
  });
  return { confirmed, revisionAfter, retainedProgress: revisionAfter > Number(turnRevisionBefore || 0) };
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
 * Expand mounted disclosures while semantic archive progress is being made.
 *
 * Beta13.1 keeps logical completion state page-side across expandMounted()
 * invocations. A virtualizer remount can reopen a disclosure only after that
 * same retained turn becomes richer. Activity in another turn cannot make it
 * eligible again, and volatile mounted-DOM membership does not reset quietness.
 */
export async function expandMounted(page, max, onProgress, shouldCancel) {
  let processed = 0;
  let reportCounter = 0;
  let activeTurnId = '';
  let quietRounds = 0;
  let previousTurnSignature = '';
  let lastSemanticProgressAt = Date.now();
  let lastObservedTurnRevision = 0;
  let idleRounds = 0;
  let previousIdleSignature = '';
  let idleStartedAt = Date.now();

  while (processed < max) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    const { result, turnRevisionBefore } = await expandOneWithRevision(page, activeTurnId);
    if (result) {
      if (result.turnId && result.turnId !== activeTurnId) {
        activeTurnId = result.turnId;
        lastObservedTurnRevision = Number(turnRevisionBefore || 0);
      } else {
        activeTurnId = result.turnId || activeTurnId;
      }

      const { confirmed, revisionAfter, retainedProgress } = await processExpansion(
        page,
        result,
        turnRevisionBefore,
        onProgress,
        shouldCancel
      );

      processed++;
      reportCounter++;
      lastObservedTurnRevision = Math.max(lastObservedTurnRevision, revisionAfter);
      idleRounds = 0;
      previousIdleSignature = '';
      idleStartedAt = Date.now();

      // Completing a previously actionable logical disclosure is semantic work
      // even when it proves that the remounted control adds no richer archive
      // state. Persisting that completion makes subsequent remounts ineligible
      // until this same turn's retained revision increases.
      if (confirmed || retainedProgress) lastSemanticProgressAt = Date.now();

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
      const timedOut = Date.now() - idleStartedAt >= TURN_QUIESCENT_MAX_WAIT_MS;
      if (idleRounds >= requiredRounds || timedOut) break;

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
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
      lastObservedTurnRevision = 0;
      continue;
    }

    const signature = semanticTurnSignature(sample, revisionAfterCapture);
    quietRounds = signature === previousTurnSignature ? quietRounds + 1 : 1;
    previousTurnSignature = signature;
    const timedOut = Date.now() - lastSemanticProgressAt >= TURN_QUIESCENT_MAX_WAIT_MS;
    const converged = quietRounds >= TURN_QUIESCENT_REQUIRED_ROUNDS;
    await markTurnQuiescence(page, activeTurnId, quietRounds, signature, converged, timedOut);

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    await onProgress?.({
      ...stats,
      expandingStatus: converged
        ? sample.actionableCollapsed > 0
          ? `${activeTurnId} semantic stall · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} unchanged rounds with ${sample.actionableCollapsed} actionable; yielding`
          : `${activeTurnId} semantic disclosure fixed point · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds`
        : timedOut
          ? `${activeTurnId} semantic progress wait hit ${TURN_QUIESCENT_MAX_WAIT_MS / 1000}s safety limit`
          : `Waiting for semantic disclosure progress in ${activeTurnId} · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds · actionable ${sample.actionableCollapsed}`
    });

    if (converged || timedOut) {
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

  if (reportCounter) await report(page, onProgress);
}

export const __testing = {
  semanticTurnSignature,
  semanticMountedSignature
};
