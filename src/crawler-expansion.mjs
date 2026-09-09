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

async function retainedRevision(page) {
  return page.evaluate(() => Number(
    window.__archiveCrawler.retainedRevision?.()
    ?? window.__archiveCrawler.state?.retainedRevision
    ?? 0
  ));
}

function logicalDisclosureKey(result) {
  const turnId = String(result?.turnId || 'unknown-turn');
  const kind = String(result?.kind || 'unknown');
  const description = String(result?.description || '');
  const prefix = `${turnId} — `;
  const stableLabel = (description.startsWith(prefix) ? description.slice(prefix.length) : description)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return [turnId, kind, stableLabel || String(result?.controls || result?.key || '')].join('|');
}

function semanticTurnSignature(sample, revision) {
  return [
    Number(revision || 0),
    Number(sample?.actionableCollapsed || 0),
    Number(sample?.closedDetails || 0),
    ...(Array.isArray(sample?.actionableKeys) ? sample.actionableKeys : [])
  ].join('|');
}

function semanticMountedSignature(sample, revision) {
  return [
    Number(revision || 0),
    Number(sample?.actionableCollapsed || 0),
    Number(sample?.closedDetails || 0),
    String(sample?.signature || '')
  ].join('|');
}

async function expandOneWithRevision(page, turnId) {
  return page.evaluate(scopeTurnId => {
    const crawler = window.__archiveCrawler;
    const revisionBefore = Number(crawler.retainedRevision?.() ?? crawler.state?.retainedRevision ?? 0);
    const result = crawler.expandOne(scopeTurnId);
    return { result, revisionBefore };
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

async function processExpansion(page, result, onProgress, shouldCancel) {
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
  const revisionAfter = await retainedRevision(page);
  await onProgress?.({
    ...activity,
    expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
  });
  return { confirmed, revisionAfter };
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
 * Beta13 deliberately does not require the live mounted DOM to become stable:
 * ChatGPT can mutate/virtualize an otherwise finished viewport forever. It also
 * does not treat clicks as progress. A repeated successfully expanded logical
 * disclosure that produces no newer retained generation yields back to the
 * outer traversal, where a later pass may legitimately revisit it.
 */
export async function expandMounted(page, max, onProgress, shouldCancel) {
  let processed = 0;
  let reportCounter = 0;
  let activeTurnId = '';
  let quietRounds = 0;
  let previousTurnSignature = '';
  let lastSemanticProgressAt = Date.now();
  let lastObservedRevision = await retainedRevision(page);
  let idleRounds = 0;
  let previousIdleSignature = '';
  let idleStartedAt = Date.now();
  const successfulLogicalKeys = new Set();

  while (processed < max) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    const { result, revisionBefore } = await expandOneWithRevision(page, activeTurnId);
    if (result) {
      activeTurnId = result.turnId || activeTurnId;
      const logicalKey = logicalDisclosureKey(result);
      const seenSuccessful = successfulLogicalKeys.has(logicalKey);
      const { confirmed, revisionAfter } = await processExpansion(page, result, onProgress, shouldCancel);
      const retainedProgress = revisionAfter > revisionBefore;

      processed++;
      reportCounter++;
      lastObservedRevision = Math.max(lastObservedRevision, revisionAfter);
      idleRounds = 0;
      previousIdleSignature = '';
      idleStartedAt = Date.now();

      if (confirmed && seenSuccessful && !retainedProgress) {
        const stats = await page.evaluate(() => window.__archiveCrawler.stats());
        await markTurnQuiescence(page, activeTurnId, TURN_QUIESCENT_REQUIRED_ROUNDS, `repeat-no-progress:${logicalKey}`, true, false);
        await onProgress?.({
          ...stats,
          expandingStatus: `${activeTurnId} semantic fixed point · repeated disclosure produced no new retained generation; yielding to traversal`
        });
        break;
      }

      if (confirmed) successfulLogicalKeys.add(logicalKey);
      if (retainedProgress || (confirmed && !seenSuccessful)) {
        lastSemanticProgressAt = Date.now();
      }

      quietRounds = 0;
      previousTurnSignature = '';
      await markTurnQuiescence(page, activeTurnId, 0, '', false, false);

      if (reportCounter >= 8) {
        await report(page, onProgress);
        reportCounter = 0;
      }
      continue;
    }

    const currentRevision = await retainedRevision(page);
    if (currentRevision > lastObservedRevision) {
      lastObservedRevision = currentRevision;
      lastSemanticProgressAt = Date.now();
      quietRounds = 0;
      previousTurnSignature = '';
    }

    if (!activeTurnId) {
      const sample = await page.evaluate(() => window.__archiveCrawler.mountedDisclosureSample());
      const signature = semanticMountedSignature(sample, currentRevision);
      const signatureChanged = signature !== previousIdleSignature;
      idleRounds = signatureChanged ? 1 : idleRounds + 1;
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
    const revisionAfterCapture = await retainedRevision(page);
    if (revisionAfterCapture > lastObservedRevision) {
      lastObservedRevision = revisionAfterCapture;
      lastSemanticProgressAt = Date.now();
    }
    const sample = await page.evaluate(turnId => window.__archiveCrawler.turnDisclosureSample(turnId), activeTurnId);

    if (!sample.mounted) {
      await markTurnQuiescence(page, activeTurnId, quietRounds, `missing:${activeTurnId}`, false, false);
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
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
  logicalDisclosureKey,
  semanticTurnSignature,
  semanticMountedSignature
};
