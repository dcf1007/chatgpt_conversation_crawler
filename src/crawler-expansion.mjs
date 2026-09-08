import { TURN_QUIESCENT_REQUIRED_ROUNDS } from './crawler-page-diagnostics.mjs';

const DISCLOSURE_STABLE_SAMPLES = 3;
const DISCLOSURE_SAMPLE_INTERVAL_MS = 120;
const DISCLOSURE_MAX_SETTLE_MS = 3600;
const TURN_QUIESCENT_ROUND_INTERVAL_MS = 180;
const TURN_QUIESCENT_MAX_WAIT_MS = 8000;
const IDLE_DISCLOSURE_REQUIRED_ROUNDS = 2;
const IDLE_DISCLOSURE_ROUND_INTERVAL_MS = 180;

async function report(page, onProgress) {
  if (!onProgress) return;
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  await onProgress({
    ...stats,
    scrollTop: metrics.top,
    scrollHeight: metrics.height,
    scrollClient: metrics.client
  });
}

async function captureActiveTurn(page, turnId) {
  if (!turnId) return page.evaluate(() => window.__archiveCrawler.capture());
  return page.evaluate(id => window.__archiveCrawler.captureTurn(id), turnId);
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

  if (result.kind === 'details') {
    await page.waitForTimeout(80);
  } else {
    await waitForDisclosureHydration(page, result, shouldCancel);
    await page.evaluate(key => window.__archiveCrawler.confirm(key), result.key);
  }

  // Disclosure hydration can be very rich, but it is local to the turn that
  // was activated. Retain that one turn here; the surrounding traversal does a
  // full mounted-range capture once per scroll position.
  const activity = await captureActiveTurn(page, result.turnId || '');
  await onProgress?.({
    ...activity,
    expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
  });
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
 * Expand disclosures to a fixed point without asking ChatGPT's whole virtual
 * viewport to become byte-stable.
 *
 * Once a disclosure is found, beta8 owns that turn until its nested disclosure
 * tree converges. `expandOne(turnId)` cannot wander into another mounted turn,
 * so a late child generation in the active turn cannot be skipped because an
 * unrelated turn happened to contain another collapsed control. Plain turns
 * mounting/unmounting at the viewport boundary never participate in the turn
 * signature.
 */
export async function expandMounted(page, max, onProgress, shouldCancel) {
  let processed = 0;
  let reportCounter = 0;
  let activeTurnId = '';
  let quietRounds = 0;
  let previousTurnSignature = '';
  let quietStartedAt = 0;
  let idleRounds = 0;
  let previousIdleSignature = '';

  while (processed < max) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    // When a turn is active, only that turn is allowed to supply the next
    // disclosure. After it converges we return to the global mounted search.
    const result = await page.evaluate(
      turnId => window.__archiveCrawler.expandOne(turnId),
      activeTurnId
    );

    if (result) {
      activeTurnId = result.turnId || activeTurnId;
      await processExpansion(page, result, onProgress, shouldCancel);
      processed++;
      reportCounter++;
      quietRounds = 0;
      previousTurnSignature = '';
      quietStartedAt = Date.now();
      idleRounds = 0;
      previousIdleSignature = '';
      await markTurnQuiescence(page, activeTurnId, 0, '', false, false);

      if (reportCounter >= 8) {
        await report(page, onProgress);
        reportCounter = 0;
      }
      continue;
    }

    if (!activeTurnId) {
      // No disclosure has been activated at this scroll position. Two matching
      // disclosure-identity samples are enough to catch a root that mounts one
      // beat late, without waiting for unrelated message DOM to stabilize.
      const sample = await page.evaluate(() => window.__archiveCrawler.mountedDisclosureSample());
      idleRounds = sample.signature === previousIdleSignature ? idleRounds + 1 : 1;
      previousIdleSignature = sample.signature;

      if (sample.actionableCollapsed > 0) {
        idleRounds = 0;
        await page.waitForTimeout(20);
        continue;
      }
      if (idleRounds >= IDLE_DISCLOSURE_REQUIRED_ROUNDS) break;
      await page.waitForTimeout(IDLE_DISCLOSURE_ROUND_INTERVAL_MS);
      continue;
    }

    await captureActiveTurn(page, activeTurnId);
    const sample = await page.evaluate(
      turnId => window.__archiveCrawler.turnDisclosureSample(turnId),
      activeTurnId
    );

    if (!sample.mounted) {
      // ChatGPT virtualized the watched turn away. Its richest state has already
      // been retained; a later traversal/reconciliation pass can revisit it.
      await markTurnQuiescence(page, activeTurnId, quietRounds, sample.signature, false, false);
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
      quietStartedAt = 0;
      continue;
    }

    if (sample.actionableCollapsed > 0 || sample.closedDetails > 0) {
      // A descendant mounted after the previous activation. The next loop will
      // call expandOne(activeTurnId) immediately.
      quietRounds = 0;
      previousTurnSignature = '';
      await page.waitForTimeout(20);
      continue;
    }

    quietRounds = sample.signature === previousTurnSignature ? quietRounds + 1 : 1;
    previousTurnSignature = sample.signature;
    const timedOut = quietStartedAt > 0 && Date.now() - quietStartedAt >= TURN_QUIESCENT_MAX_WAIT_MS;
    const converged = quietRounds >= TURN_QUIESCENT_REQUIRED_ROUNDS;
    await markTurnQuiescence(page, activeTurnId, quietRounds, sample.signature, converged, timedOut);

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    await onProgress?.({
      ...stats,
      expandingStatus: converged
        ? `${activeTurnId} disclosure fixed point · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds`
        : timedOut
          ? `${activeTurnId} turn-scoped disclosure wait hit ${TURN_QUIESCENT_MAX_WAIT_MS / 1000}s safety limit`
          : `Waiting for nested disclosures in ${activeTurnId} · ${quietRounds}/${TURN_QUIESCENT_REQUIRED_ROUNDS} quiet rounds · actionable ${sample.actionableCollapsed}`
    });

    if (converged || timedOut) {
      // Finish this turn, then continue scanning the same mounted viewport for
      // another turn that may need expansion. This preserves complete mounted
      // coverage without coupling the turns' quiescence signatures.
      activeTurnId = '';
      quietRounds = 0;
      previousTurnSignature = '';
      quietStartedAt = 0;
      idleRounds = 0;
      previousIdleSignature = '';
      continue;
    }

    await page.waitForTimeout(TURN_QUIESCENT_ROUND_INTERVAL_MS);
  }

  if (reportCounter) await report(page, onProgress);
}
