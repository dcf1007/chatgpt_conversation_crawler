import { expandMounted } from './crawler-expansion.mjs';
import { processTurnToFixedPoint, retainedTurnIds } from './crawler-turn-processing.mjs';
import { ensurePageForegroundProtection } from './runtime-browser.mjs';

const SCAN_MAX_STEPS = 2000;
const SCAN_ENDPOINT_STABLE_CHECKS = 6;
const OLDEST_REQUIRED_QUIET_CHECKS = 12;
const OLDEST_MAX_CHECKS = 180;
const OLDEST_PROBE_MIN_NUDGE_PX = 220;
const OLDEST_PROBE_MAX_NUDGE_PX = 520;
const RECONCILIATION_MAX_PASSES = 2;
const RECONCILIATION_STABLE_PASSES = 1;
const NAVIGATION_STAGNATION_REASSERT = 2;
const TURN_DISCOVERY_MAX_BATCHES = 3;

export const CRAWLER_PROGRESS_LIMITS = Object.freeze({
  scanPasses: 3,
  scanMaxSteps: SCAN_MAX_STEPS,
  scanEndpointStableChecks: SCAN_ENDPOINT_STABLE_CHECKS,
  oldestRequiredQuietChecks: OLDEST_REQUIRED_QUIET_CHECKS,
  oldestMaxChecks: OLDEST_MAX_CHECKS,
  reconciliationMaxPasses: RECONCILIATION_MAX_PASSES
});

async function report(page, onProgress, extra = {}) {
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  await onProgress?.({
    ...stats,
    scrollTop: metrics.top,
    scrollHeight: metrics.height,
    scrollClient: metrics.client,
    ...extra
  });
  return { stats, metrics };
}

function traversalProgressSignature(metrics, stats, { normalizeTop = false } = {}) {
  return [
    normalizeTop ? 0 : Math.round(metrics.top),
    Math.round(metrics.height),
    stats.turns,
    stats.oldestRetained,
    stats.newestRetained,
    stats.retainedCorpusFingerprint,
    stats.preBlocks,
    stats.codeBlocks,
    stats.mediaElements,
    stats.timelineMarkers,
    stats.retainedUnresolvedTurns,
    stats.retainedUnresolvedDisclosures
  ].join('|');
}

function oldestProbeNudge(metrics) {
  const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
  if (!maximumTop) return 0;
  const viewportNudge = Math.floor(Number(metrics.client || 0) * 0.38);
  return Math.min(
    maximumTop,
    Math.max(
      OLDEST_PROBE_MIN_NUDGE_PX,
      Math.min(OLDEST_PROBE_MAX_NUDGE_PX, viewportNudge)
    )
  );
}

function nextReconciliationStablePasses(current, processingConverged, sameFingerprint) {
  if (!processingConverged || !sameFingerprint) return 0;
  return Math.max(0, Number(current || 0)) + 1;
}

function traversalCompletionSummary(scans, oldest, reconciliation, turnProcessing = []) {
  const nonConvergedScans = scans.filter(result => !result.converged).length;
  const failedTurns = turnProcessing.filter(result => !result.converged).length;
  const traversalBase = nonConvergedScans === 0
    ? oldest.converged
      ? 'Discovery + reverse/forward verification converged with oldest-edge convergence'
      : `Verification sweeps converged; oldest-edge safety limit (${oldest.quietChecks}/${oldest.requiredQuietChecks} stable)`
    : `${nonConvergedScans} traversal sweep(s) reached their safety limit`;
  const turnPart = failedTurns ? `; ${failedTurns} retained turn(s) did not reach a turn-local fixed point` : '';
  return reconciliation.rounds > 0
    ? `${traversalBase}${turnPart}; targeted retained reconciliation ${reconciliation.converged ? 'converged' : 'stopped'} after ${reconciliation.rounds} pass(es)`
    : `${traversalBase}${turnPart}`;
}

/**
 * Existing mounted-range expansion scan retained for direct callers/tests. The
 * v1.7.1 automatic orchestration uses captureSweep + turn-local processing so
 * unrelated mounted turns cannot own convergence for a retained target.
 */
export async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = SCAN_MAX_STEPS) {
  await ensurePageForegroundProtection(page).catch(() => {});
  await page.evaluate(() => window.__archiveCrawler.resetNavigation());

  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(
    top => window.__archiveCrawler.setTop(top),
    direction === 'down' ? 0 : Math.max(0, first.height - first.client)
  );
  await page.waitForTimeout(350);

  let stableChecks = 0;
  let previousSignature = '';
  let steps = 0;
  let converged = false;

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    steps = step + 1;
    await expandMounted(page, 180, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const maximumTop = Math.max(0, metrics.height - metrics.client);
    const atEnd = direction === 'down' ? metrics.top >= maximumTop - 4 : metrics.top <= 4;
    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const signature = traversalProgressSignature(metrics, stats);

    if (Number(stats.navigationStagnantSteps || 0) >= NAVIGATION_STAGNATION_REASSERT) {
      await ensurePageForegroundProtection(page).catch(() => {});
    }

    if (atEnd && signature === previousSignature) stableChecks++;
    else if (atEnd) stableChecks = 1;
    else stableChecks = 0;

    const positionPercent = maximumTop <= 0 ? 100 : Math.max(0, Math.min(100, (metrics.top / maximumTop) * 100));
    const arrow = direction === 'up' ? '↑' : '↓';
    const edgeStatus = atEnd
      ? ` · edge stable ${Math.min(stableChecks, SCAN_ENDPOINT_STABLE_CHECKS)}/${SCAN_ENDPOINT_STABLE_CHECKS}`
      : '';

    await onProgress?.({
      ...stats,
      stage: 'traversal',
      phase: 'Scanning conversation',
      detail: 'Capturing mounted turns, timeline markers, disclosures, and asynchronously hydrated content as they appear.',
      scanningStatus: `Pass ${pass}/3 ${arrow} · step ${steps}/${maxSteps} · ${positionPercent.toFixed(1)}% loaded range · mounted first ${stats.mountedFirst}${edgeStatus}`,
      scanComplete: false,
      pass,
      direction,
      step: steps,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && stableChecks >= SCAN_ENDPOINT_STABLE_CHECKS) {
      converged = true;
      break;
    }
    previousSignature = signature;

    const fraction = direction === 'up' ? 0.42 : 0.62;
    const minimumStep = direction === 'up' ? 280 : 320;
    const stepSize = Math.max(minimumStep, Math.floor(metrics.client * fraction));
    const nextTop = direction === 'down'
      ? Math.min(maximumTop, metrics.top + stepSize)
      : Math.max(0, metrics.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.navigateTop(top), nextTop);
    await page.waitForTimeout(direction === 'up' ? 260 : 200);
  }

  const result = {
    converged,
    pass,
    direction,
    steps,
    maxSteps,
    stableChecks,
    requiredStableChecks: SCAN_ENDPOINT_STABLE_CHECKS
  };
  await page.evaluate(value => window.__archiveCrawler.markScanResult?.(value), result);

  if (!converged) {
    await report(page, onProgress, {
      stage: 'traversal',
      phase: 'Traversal safety limit reached',
      detail: `Pass ${pass} ${direction} did not prove endpoint convergence within ${maxSteps} steps. The retained content is preserved and final integrity reporting will flag the incomplete convergence.`,
      scanningStatus: `Pass ${pass}/3 ${direction === 'up' ? '↑' : '↓'} · safety limit ${steps}/${maxSteps}`,
      scanComplete: false,
      pass,
      direction,
      step: steps
    });
  }
  return result;
}

/** Capture-only sweep used for discovery and final corpus verification. */
async function captureSweep(page, direction, pass, phase, onProgress, shouldCancel, maxSteps = SCAN_MAX_STEPS) {
  await ensurePageForegroundProtection(page).catch(() => {});
  await page.evaluate(() => window.__archiveCrawler.resetNavigation());
  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(
    top => window.__archiveCrawler.setTop(top),
    direction === 'down' ? 0 : Math.max(0, first.height - first.client)
  );
  await page.waitForTimeout(350);

  let stableChecks = 0;
  let previousSignature = '';
  let steps = 0;
  let converged = false;

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    steps = step + 1;
    await page.evaluate(() => window.__archiveCrawler.capture());
    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const maximumTop = Math.max(0, metrics.height - metrics.client);
    const atEnd = direction === 'down' ? metrics.top >= maximumTop - 4 : metrics.top <= 4;
    const signature = traversalProgressSignature(metrics, stats);

    if (atEnd && signature === previousSignature) stableChecks++;
    else if (atEnd) stableChecks = 1;
    else stableChecks = 0;

    const positionPercent = maximumTop <= 0 ? 100 : Math.max(0, Math.min(100, (metrics.top / maximumTop) * 100));
    const arrow = direction === 'up' ? '↑' : '↓';
    await onProgress?.({
      ...stats,
      stage: 'traversal',
      phase,
      detail: pass === 1
        ? 'Recording retained turn identities/order and every mounted generation encountered before turn-local processing.'
        : 'Verifying retained semantic revisions without blindly reopening already-converged disclosures.',
      scanningStatus: `Pass ${pass}/3 ${arrow} · step ${steps}/${maxSteps} · ${positionPercent.toFixed(1)}% loaded range${atEnd ? ` · edge stable ${stableChecks}/${SCAN_ENDPOINT_STABLE_CHECKS}` : ''}`,
      scanComplete: false,
      pass,
      direction,
      step: steps,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && stableChecks >= SCAN_ENDPOINT_STABLE_CHECKS) {
      converged = true;
      break;
    }
    previousSignature = signature;

    const fraction = direction === 'up' ? 0.46 : 0.60;
    const minimumStep = direction === 'up' ? 260 : 300;
    const stepSize = Math.max(minimumStep, Math.floor(metrics.client * fraction));
    const nextTop = direction === 'down'
      ? Math.min(maximumTop, metrics.top + stepSize)
      : Math.max(0, metrics.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.navigateTop(top), nextTop);
    await page.waitForTimeout(direction === 'up' ? 240 : 190);
  }

  const result = { converged, pass, direction, steps, maxSteps, stableChecks, requiredStableChecks: SCAN_ENDPOINT_STABLE_CHECKS, phase };
  await page.evaluate(value => window.__archiveCrawler.markScanResult?.(value), result);
  return result;
}

export async function verifyOldestMessages(page, onProgress, shouldCancel) {
  let quietChecks = 0;
  let previousSignature = '';
  let checks = 0;

  await ensurePageForegroundProtection(page).catch(() => {});
  await page.evaluate(() => window.__archiveCrawler.resetNavigation());
  await onProgress?.({
    stage: 'oldest_verification',
    phase: 'Verifying oldest messages',
    detail: 'Live-preview rebuilding is paused while the oldest edge is probed for asynchronously prepended turns.',
    scanningStatus: `Oldest-edge probe · check 0/${OLDEST_MAX_CHECKS} · stable 0/${OLDEST_REQUIRED_QUIET_CHECKS}`,
    scanComplete: false,
    pass: 0,
    direction: 'up',
    step: 0,
    previewPaused: true,
    oldestConverged: null,
    oldestQuietChecks: 0,
    oldestChecks: 0
  });

  for (let check = 0; check < OLDEST_MAX_CHECKS; check++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    checks = check + 1;
    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const atTop = metrics.top <= 4;
    const signature = traversalProgressSignature(metrics, stats, { normalizeTop: atTop });
    if (atTop && signature === previousSignature) quietChecks++;
    else quietChecks = 0;
    previousSignature = signature;

    await onProgress?.({
      ...stats,
      stage: 'oldest_verification',
      phase: 'Verifying oldest messages',
      scanningStatus: `Oldest-edge probe · check ${checks}/${OLDEST_MAX_CHECKS} · stable ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} · ${atTop ? 'at top' : `offset ${Math.round(metrics.top)}px`} · mounted first ${stats.mountedFirst}`,
      oldestRetained: stats.oldestRetained,
      scanComplete: false,
      pass: 0,
      direction: 'up',
      step: checks,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client,
      previewPaused: true,
      oldestConverged: false,
      oldestQuietChecks: quietChecks,
      oldestChecks: checks
    });

    if (quietChecks >= OLDEST_REQUIRED_QUIET_CHECKS) break;
    if (!atTop) {
      await page.waitForTimeout(260);
      await page.evaluate(() => window.__archiveCrawler.setTop(0));
    } else if (quietChecks >= 2) {
      const nudge = oldestProbeNudge(metrics);
      if (nudge > 0) {
        await page.evaluate(top => window.__archiveCrawler.setTop(top), nudge);
        await page.waitForTimeout(260);
        await page.evaluate(() => window.__archiveCrawler.setTop(0));
      }
    }
    await page.waitForTimeout(420);
  }

  const converged = quietChecks >= OLDEST_REQUIRED_QUIET_CHECKS;
  const result = { converged, quietChecks, checks, requiredQuietChecks: OLDEST_REQUIRED_QUIET_CHECKS, maxChecks: OLDEST_MAX_CHECKS };
  await page.evaluate(value => window.__archiveCrawler.markOldestVerification(value), result);

  await report(page, onProgress, {
    stage: 'oldest_verification',
    phase: converged ? 'Oldest-message verification complete' : 'Oldest-message verification safety limit reached',
    detail: converged
      ? 'The oldest edge converged; beginning the discovery sweep.'
      : `The oldest edge did not reach ${OLDEST_REQUIRED_QUIET_CHECKS}/${OLDEST_REQUIRED_QUIET_CHECKS} quiet checks before the ${OLDEST_MAX_CHECKS}-check safety limit; continuing with discovery and recording a warning in the archive.`,
    scanningStatus: converged
      ? `Oldest-edge probe complete · stable ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks} checks`
      : `Oldest-edge probe safety limit · stable ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks}/${OLDEST_MAX_CHECKS} checks`,
    pass: 0,
    direction: 'up',
    previewPaused: false,
    oldestConverged: converged,
    oldestQuietChecks: quietChecks,
    oldestChecks: checks
  });
  return result;
}

async function retainedDisclosureSummary(page) {
  return page.evaluate(() => window.__archiveCrawler.retainedDisclosureSummary());
}

async function fullUnresolvedTurnIds(page) {
  return page.evaluate(() => Object.values(window.__archiveCrawler?.state?.turns || {})
    .filter(turn => Number(turn?.remaining || 0) > 0)
    .map(turn => turn.id)
    .filter(Boolean)
    .sort((left, right) => {
      const number = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
      return number(left) - number(right) || left.localeCompare(right);
    }));
}

async function turnRevisionMap(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(window.__archiveCrawler?.state?.turns || {}).map(id => [
    id,
    Number(window.__archiveCrawler.turnRevision?.(id) || 0)
  ])));
}

function changedTurnIds(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...ids].filter(id => Number(before?.[id] ?? -1) !== Number(after?.[id] ?? -1));
}

async function processRetainedTurnBatch(page, ids, onProgress, shouldCancel, processedSet = new Set()) {
  const results = [];
  for (const turnId of ids) {
    if (processedSet.has(turnId)) continue;
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const currentRetained = await retainedTurnIds(page);
    if (!currentRetained.includes(turnId)) continue;
    const result = await processTurnToFixedPoint(page, turnId, currentRetained, { shouldCancel, onProgress });
    processedSet.add(turnId);
    results.push({ turnId, ...result });
    await page.evaluate(value => window.__archiveCrawler.markTurnProcessingResult?.(value), { turnId, ...result });
  }
  return results;
}

export async function reconcileRetainedDisclosures(page, onProgress, shouldCancel) {
  let summary = await retainedDisclosureSummary(page);
  let previousFingerprint = summary.fingerprint;
  let stablePasses = 0;
  let rounds = 0;

  if (summary.retainedUnresolvedDisclosures === 0) {
    const result = { converged: true, rounds: 0, stablePasses: 0, unresolvedTurns: 0, unresolvedDisclosures: 0 };
    await page.evaluate(value => window.__archiveCrawler.markReconciliation(value), result);
    return result;
  }

  for (let round = 1; round <= RECONCILIATION_MAX_PASSES; round++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    rounds = round;
    const unresolvedIds = await fullUnresolvedTurnIds(page);
    await onProgress?.({
      ...(await page.evaluate(() => window.__archiveCrawler.stats())),
      stage: 'reconciliation',
      phase: 'Reconciling retained disclosures',
      detail: 'Revisiting only retained turns that still report recognized unresolved content disclosures.',
      scanningStatus: `Targeted reconciliation ${round}/${RECONCILIATION_MAX_PASSES} · ${unresolvedIds.length} unresolved turn(s)`,
      scanComplete: false,
      pass: 0,
      direction: '',
      step: 0
    });

    const retained = await retainedTurnIds(page);
    let processingConverged = true;
    for (const turnId of unresolvedIds) {
      const result = await processTurnToFixedPoint(page, turnId, retained, { shouldCancel, onProgress });
      await page.evaluate(value => window.__archiveCrawler.markTurnProcessingResult?.(value), { turnId, ...result, reconciliationRound: round });
      if (!result.converged) processingConverged = false;
    }

    summary = await retainedDisclosureSummary(page);
    stablePasses = nextReconciliationStablePasses(
      stablePasses,
      processingConverged,
      summary.fingerprint === previousFingerprint
    );
    previousFingerprint = summary.fingerprint;
    if (summary.retainedUnresolvedDisclosures === 0 || stablePasses >= RECONCILIATION_STABLE_PASSES) break;
  }

  const result = {
    converged: summary.retainedUnresolvedDisclosures === 0,
    rounds,
    stablePasses,
    unresolvedTurns: summary.retainedUnresolvedTurns,
    unresolvedDisclosures: summary.retainedUnresolvedDisclosures
  };
  await page.evaluate(value => window.__archiveCrawler.markReconciliation(value), result);
  await report(page, onProgress, {
    stage: 'reconciliation',
    phase: result.converged ? 'Retained-disclosure reconciliation complete' : 'Retained-disclosure reconciliation stopped',
    detail: result.converged
      ? `All retained recognized disclosures converged after ${rounds} targeted reconciliation pass(es).`
      : `Targeted reconciliation stopped after ${rounds} pass(es) with ${result.unresolvedTurns} retained turn(s) and ${result.unresolvedDisclosures} disclosure(s) still flagged. Retained content is preserved and the limitation is reported.`,
    scanningStatus: result.converged
      ? `Retained disclosure corpus converged · ${rounds} targeted pass(es)`
      : `Retained targeted reconciliation stopped · ${result.unresolvedTurns} turn(s) / ${result.unresolvedDisclosures} disclosure(s) remain`,
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0
  });
  return result;
}

export async function runAutomaticTraversal(page, { onProgress, shouldCancel } = {}) {
  await report(page, onProgress, {
    stage: 'preparing',
    phase: 'Preparing crawler',
    detail: 'Installed page-side capture helpers; preparing oldest-edge verification and discovery.',
    scanningStatus: 'Not started',
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false
  });

  const oldest = await verifyOldestMessages(page, onProgress, shouldCancel);
  const scans = [];
  scans.push(await captureSweep(page, 'down', 1, 'Discovering retained turns', onProgress, shouldCancel));

  const processed = new Set();
  const turnProcessing = [];
  for (let batch = 0; batch < TURN_DISCOVERY_MAX_BATCHES; batch++) {
    const ids = await retainedTurnIds(page);
    const pending = ids.filter(id => !processed.has(id));
    if (!pending.length) break;
    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(250);
    turnProcessing.push(...await processRetainedTurnBatch(page, pending, onProgress, shouldCancel, processed));
  }

  const revisionsBeforeReverse = await turnRevisionMap(page);
  scans.push(await captureSweep(page, 'up', 2, 'Reverse verification sweep', onProgress, shouldCancel));
  const revisionsAfterReverse = await turnRevisionMap(page);

  scans.push(await captureSweep(page, 'down', 3, 'Forward verification sweep', onProgress, shouldCancel));
  const revisionsAfterForward = await turnRevisionMap(page);

  const dirty = new Set([
    ...changedTurnIds(revisionsBeforeReverse, revisionsAfterReverse),
    ...changedTurnIds(revisionsAfterReverse, revisionsAfterForward),
    ...(await fullUnresolvedTurnIds(page))
  ]);
  if (dirty.size) {
    const ids = (await retainedTurnIds(page)).filter(id => dirty.has(id));
    turnProcessing.push(...await processRetainedTurnBatch(page, ids, onProgress, shouldCancel, new Set()));
  }

  const reconciliation = await reconcileRetainedDisclosures(page, onProgress, shouldCancel);
  await page.evaluate(() => window.__archiveCrawler.capture());

  const traversalConverged = scans.every(result => result.converged)
    && turnProcessing.every(result => result.converged);
  const traversalSummary = traversalCompletionSummary(scans, oldest, reconciliation, turnProcessing);

  await report(page, onProgress, {
    stage: 'finalization',
    phase: 'Turn/corpus convergence complete',
    detail: 'Discovery, per-turn viewport coverage, scoped disclosure expansion, reverse/forward verification, and targeted reconciliation are finished; preparing final integrity validation.',
    scanningStatus: traversalSummary,
    scanComplete: true,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false,
    oldestConverged: oldest.converged,
    oldestQuietChecks: oldest.quietChecks,
    oldestChecks: oldest.checks
  });

  return {
    scans,
    oldest,
    reconciliation,
    finalExpansion: { converged: true, processed: 0, reason: 'turn-scoped-finalization' },
    turnProcessing,
    traversalConverged
  };
}

export const __testing = {
  traversalProgressSignature,
  nextReconciliationStablePasses,
  changedTurnIds,
  NAVIGATION_STAGNATION_REASSERT
};
