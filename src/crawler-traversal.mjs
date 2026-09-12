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
const TURN_WORK_QUEUE_MAX_ITEMS = 10000;

export const CRAWLER_PROGRESS_LIMITS = Object.freeze({
  scanMaxSteps: SCAN_MAX_STEPS,
  scanEndpointStableChecks: SCAN_ENDPOINT_STABLE_CHECKS,
  oldestRequiredQuietChecks: OLDEST_REQUIRED_QUIET_CHECKS,
  oldestMaxChecks: OLDEST_MAX_CHECKS,
  reconciliationMaxPasses: RECONCILIATION_MAX_PASSES,
  turnWorkQueueMaxItems: TURN_WORK_QUEUE_MAX_ITEMS
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

/** Retained semantic state is the only traversal convergence authority. */
function traversalProgressSignature(_metrics, stats) {
  return [
    stats.turns,
    stats.oldestRetained,
    stats.newestRetained,
    stats.retainedCorpusFingerprint,
    stats.timelineMarkers
  ].join('|');
}

function oldestProbeNudge(metrics) {
  const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
  if (!maximumTop) return 0;
  const viewportNudge = Math.floor(Number(metrics.client || 0) * 0.38);
  return Math.min(
    maximumTop,
    Math.max(OLDEST_PROBE_MIN_NUDGE_PX, Math.min(OLDEST_PROBE_MAX_NUDGE_PX, viewportNudge))
  );
}

function nextReconciliationStablePasses(current, processingConverged, sameFingerprint) {
  if (!processingConverged || !sameFingerprint) return 0;
  return Math.max(0, Number(current || 0)) + 1;
}

function traversalCompletionSummary(scans, oldest, reconciliation, _turnProcessing = [], finalStats = {}) {
  const nonConvergedScans = scans.filter(result => !result.converged).length;
  const failedTurns = Number(finalStats.turnProcessingFailures || 0);
  const parts = [];
  parts.push(nonConvergedScans === 0
    ? 'Passive discovery/verification sweeps converged'
    : `${nonConvergedScans} passive traversal sweep(s) reached their safety limit`);
  parts.push(oldest.converged
    ? 'oldest edge converged'
    : `oldest edge stopped at ${oldest.quietChecks}/${oldest.requiredQuietChecks} stable checks`);
  parts.push(failedTurns ? `${failedTurns} retained turn(s) remain non-converged` : 'turn-local processing converged');
  parts.push(reconciliation.converged
    ? 'logical disclosure reconciliation converged'
    : `logical disclosure reconciliation stopped with ${Number(finalStats.retainedUnresolvedDisclosures || 0)} actionable disclosure(s)`);
  return parts.join('; ');
}

async function exactEndpoint(page, direction) {
  return page.evaluate(dir => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
    const targetTop = dir === 'down' ? maximumTop : 0;
    crawler.setTop(targetTop);
    return { targetTop, maximumTop };
  }, direction);
}

async function sampleSweepState(page) {
  await page.evaluate(() => window.__archiveCrawler.capture());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  return { metrics, stats };
}

/** Compatibility direct caller: same passive semantic primitive as beta3. */
export async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = SCAN_MAX_STEPS) {
  return captureSweep(page, direction, `Compatibility passive scan ${pass}`, onProgress, shouldCancel, maxSteps, pass);
}

/** Capture-only sweep used for discovery and remount verification. */
async function captureSweep(page, direction, phase, onProgress, shouldCancel, maxSteps = SCAN_MAX_STEPS, pass = 0) {
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
  let endpointMode = false;

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    steps = step + 1;

    let { metrics, stats } = await sampleSweepState(page);
    let maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
    let atEnd = direction === 'down' ? metrics.top >= maximumTop - 4 : metrics.top <= 4;
    if (atEnd) endpointMode = true;

    if (endpointMode) {
      // Once the logical edge has first been reached, stay in exact endpoint
      // mode. Physical height can move under the virtualizer; repeated setTop()
      // repins geometry without resetting semantic quietness.
      await exactEndpoint(page, direction);
      await page.waitForTimeout(80);
      ({ metrics, stats } = await sampleSweepState(page));
      maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
      atEnd = direction === 'down' ? metrics.top >= maximumTop - 4 : metrics.top <= 4;
    }

    const signature = traversalProgressSignature(metrics, stats);
    if (endpointMode && signature === previousSignature) stableChecks++;
    else if (endpointMode) stableChecks = 1;
    else stableChecks = 0;

    const positionPercent = maximumTop <= 0 ? 100 : Math.max(0, Math.min(100, (metrics.top / maximumTop) * 100));
    const arrow = direction === 'up' ? '↑' : '↓';
    await onProgress?.({
      ...stats,
      stage: 'traversal',
      phase,
      detail: phase.includes('discovery')
        ? 'Passively recording retained turn identities/order and semantic generations before active turn processing.'
        : 'Passively remounting the corpus to challenge retained semantic revisions without blindly reopening completed disclosures.',
      scanningStatus: `${phase} ${arrow} · step ${steps}/${maxSteps} · ${positionPercent.toFixed(1)}% loaded range${endpointMode ? ` · semantic edge quiet ${stableChecks}/${SCAN_ENDPOINT_STABLE_CHECKS}${atEnd ? '' : ' · repinning geometry'}` : ''}`,
      scanComplete: false,
      pass,
      direction,
      step: steps,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (endpointMode && stableChecks >= SCAN_ENDPOINT_STABLE_CHECKS) {
      converged = true;
      break;
    }
    if (endpointMode) previousSignature = signature;

    if (endpointMode) {
      await page.waitForTimeout(direction === 'up' ? 240 : 190);
      continue;
    }

    const fraction = direction === 'up' ? 0.46 : 0.60;
    const minimumStep = direction === 'up' ? 260 : 300;
    const stepSize = Math.max(minimumStep, Math.floor(Number(metrics.client || 0) * fraction));
    const nextTop = direction === 'down'
      ? Math.min(maximumTop, Number(metrics.top || 0) + stepSize)
      : Math.max(0, Number(metrics.top || 0) - stepSize);

    const exact = direction === 'down' ? nextTop >= maximumTop - 0.5 : nextTop <= 0.5;
    if (exact) await page.evaluate(top => window.__archiveCrawler.setTop(top), direction === 'down' ? maximumTop : 0);
    else await page.evaluate(top => window.__archiveCrawler.navigateTop(top), nextTop);
    await page.waitForTimeout(direction === 'up' ? 240 : 190);
  }

  const result = {
    converged,
    pass,
    direction,
    steps,
    maxSteps,
    stableChecks,
    requiredStableChecks: SCAN_ENDPOINT_STABLE_CHECKS,
    phase
  };
  await page.evaluate(value => window.__archiveCrawler.markScanResult?.(value), result);

  if (!converged) {
    await report(page, onProgress, {
      stage: 'traversal',
      phase: `${phase} safety limit reached`,
      detail: `${phase} did not prove semantic endpoint convergence within ${maxSteps} steps. Retained content is preserved and final integrity reporting will flag the incomplete convergence.`,
      scanningStatus: `${phase} ${direction === 'up' ? '↑' : '↓'} · safety limit ${steps}/${maxSteps}`,
      scanComplete: false,
      pass,
      direction,
      step: steps
    });
  }
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
    scanningStatus: `Oldest-edge probe · check 0/${OLDEST_MAX_CHECKS} · semantic quiet 0/${OLDEST_REQUIRED_QUIET_CHECKS}`,
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
    const signature = traversalProgressSignature(metrics, stats);
    if (atTop && signature === previousSignature) quietChecks++;
    else if (atTop) quietChecks = 1;
    else quietChecks = 0;
    if (atTop) previousSignature = signature;

    await onProgress?.({
      ...stats,
      stage: 'oldest_verification',
      phase: 'Verifying oldest messages',
      scanningStatus: `Oldest-edge probe · check ${checks}/${OLDEST_MAX_CHECKS} · semantic quiet ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} · ${atTop ? 'at top' : `offset ${Math.round(metrics.top)}px`} · mounted first ${stats.mountedFirst}`,
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
      ? 'The oldest edge converged semantically.'
      : `The oldest edge did not reach ${OLDEST_REQUIRED_QUIET_CHECKS}/${OLDEST_REQUIRED_QUIET_CHECKS} quiet checks before the ${OLDEST_MAX_CHECKS}-check safety limit; continuing while recording an archive warning.`,
    scanningStatus: converged
      ? `Oldest-edge probe complete · semantic quiet ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks} checks`
      : `Oldest-edge probe safety limit · semantic quiet ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks}/${OLDEST_MAX_CHECKS} checks`,
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
  const summary = await retainedDisclosureSummary(page);
  return Array.isArray(summary.retainedUnresolvedTurnIdsFull)
    ? summary.retainedUnresolvedTurnIdsFull
    : summary.retainedUnresolvedTurnIds || [];
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

async function processRetainedTurnBatch(page, ids, onProgress, shouldCancel, processedSet = null) {
  const results = [];
  for (const turnId of ids) {
    if (processedSet?.has(turnId)) continue;
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const currentRetained = await retainedTurnIds(page);
    if (!currentRetained.includes(turnId)) continue;
    const result = await processTurnToFixedPoint(page, turnId, currentRetained, { shouldCancel, onProgress });
    processedSet?.add(turnId);
    results.push({ turnId, ...result });
    await page.evaluate(value => window.__archiveCrawler.markTurnProcessingResult?.(value), { turnId, ...result });
  }
  return results;
}

async function processAllUnprocessed(page, onProgress, shouldCancel, processedSet) {
  const results = [];
  while (true) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const ids = await retainedTurnIds(page);
    const pending = ids.filter(id => !processedSet.has(id));
    if (!pending.length) break;
    if (processedSet.size + pending.length > TURN_WORK_QUEUE_MAX_ITEMS) {
      const limitResult = {
        converged: false,
        phase: 'turn-work-queue',
        direction: '',
        steps: processedSet.size,
        maxSteps: TURN_WORK_QUEUE_MAX_ITEMS,
        reason: 'turn-work-queue-limit'
      };
      await page.evaluate(value => window.__archiveCrawler.markScanResult?.(value), limitResult);
      break;
    }
    results.push(...await processRetainedTurnBatch(page, pending, onProgress, shouldCancel, processedSet));
  }
  return results;
}

async function dirtyTurnIds(page, before, after, processedSet = null) {
  const dirty = new Set([
    ...changedTurnIds(before, after),
    ...(await fullUnresolvedTurnIds(page))
  ]);
  if (processedSet) {
    for (const id of await retainedTurnIds(page)) if (!processedSet.has(id)) dirty.add(id);
  }
  return (await retainedTurnIds(page)).filter(id => dirty.has(id));
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
      detail: 'Revisiting only retained turns whose logical disclosure proof is stale or absent at the current semantic revision.',
      scanningStatus: `Targeted reconciliation ${round}/${RECONCILIATION_MAX_PASSES} · ${unresolvedIds.length} actionable turn(s)`,
      scanComplete: false,
      pass: 0,
      direction: '',
      step: 0
    });

    let processingConverged = true;
    for (const turnId of unresolvedIds) {
      const retained = await retainedTurnIds(page);
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
      ? `All retained actionable logical disclosures converged after ${rounds} targeted reconciliation pass(es).`
      : `Targeted reconciliation stopped after ${rounds} pass(es) with ${result.unresolvedTurns} retained turn(s) and ${result.unresolvedDisclosures} actionable disclosure(s) still unproved.`,
    scanningStatus: result.converged
      ? `Logical disclosure corpus converged · ${rounds} targeted pass(es)`
      : `Targeted reconciliation stopped · ${result.unresolvedTurns} turn(s) / ${result.unresolvedDisclosures} actionable disclosure(s) remain`,
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
    phase: 'Preparing beta3 semantic crawler',
    detail: 'Preparing passive bidirectional discovery, turn-local processing, remount verification, and targeted closure.',
    scanningStatus: 'Not started',
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false
  });

  await page.evaluate(() => window.__archiveCrawler.setTop(0));
  await page.waitForTimeout(250);

  const scans = [];
  scans.push(await captureSweep(page, 'down', 'Forward passive discovery', onProgress, shouldCancel));
  scans.push(await captureSweep(page, 'up', 'Reverse passive discovery', onProgress, shouldCancel));
  const oldest = await verifyOldestMessages(page, onProgress, shouldCancel);

  const processed = new Set();
  const turnProcessing = [];
  turnProcessing.push(...await processAllUnprocessed(page, onProgress, shouldCancel, processed));

  const revisionsBeforeForward = await turnRevisionMap(page);
  scans.push(await captureSweep(page, 'down', 'Forward remount verification', onProgress, shouldCancel));
  const revisionsAfterForward = await turnRevisionMap(page);
  const forwardDirty = await dirtyTurnIds(page, revisionsBeforeForward, revisionsAfterForward, processed);
  if (forwardDirty.length) {
    turnProcessing.push(...await processRetainedTurnBatch(page, forwardDirty, onProgress, shouldCancel));
    for (const id of forwardDirty) processed.add(id);
  }
  turnProcessing.push(...await processAllUnprocessed(page, onProgress, shouldCancel, processed));

  const semanticChangedDuringForwardClosure = changedTurnIds(revisionsBeforeForward, revisionsAfterForward).length > 0
    || forwardDirty.length > 0;

  // Keep the retention observer active for every broad passive sweep so even a
  // mount-and-detach inside the optional reverse closure is retained.
  if (semanticChangedDuringForwardClosure) {
    const beforeReverseClosure = await turnRevisionMap(page);
    scans.push(await captureSweep(page, 'up', 'Conditional reverse closure', onProgress, shouldCancel));
    const afterReverseClosure = await turnRevisionMap(page);
    const reverseDirty = await dirtyTurnIds(page, beforeReverseClosure, afterReverseClosure, processed);
    if (reverseDirty.length) {
      turnProcessing.push(...await processRetainedTurnBatch(page, reverseDirty, onProgress, shouldCancel));
      for (const id of reverseDirty) processed.add(id);
    }
    turnProcessing.push(...await processAllUnprocessed(page, onProgress, shouldCancel, processed));
  }

  // Only after all broad traversal is finished do we drain and seal passive
  // retention. Semantic work delivered by that final drain is processed before
  // the final convergence decision; no asynchronous observer remains afterward.
  const revisionsBeforeSeal = await turnRevisionMap(page);
  await page.evaluate(() => window.__archiveCrawler.sealMountRetention?.());
  const revisionsAfterSeal = await turnRevisionMap(page);
  const sealDirty = await dirtyTurnIds(page, revisionsBeforeSeal, revisionsAfterSeal, processed);
  if (sealDirty.length) {
    turnProcessing.push(...await processRetainedTurnBatch(page, sealDirty, onProgress, shouldCancel));
    for (const id of sealDirty) processed.add(id);
  }
  turnProcessing.push(...await processAllUnprocessed(page, onProgress, shouldCancel, processed));

  const reconciliation = await reconcileRetainedDisclosures(page, onProgress, shouldCancel);
  const finalStats = await page.evaluate(() => window.__archiveCrawler.stats());

  const traversalConverged = scans.every(result => result.converged)
    && oldest.converged
    && Number(finalStats.turnProcessingFailures || 0) === 0
    && reconciliation.converged
    && Number(finalStats.retainedUnresolvedDisclosures || 0) === 0
    && Boolean(finalStats.mountRetentionSealed);
  const traversalSummary = traversalCompletionSummary(scans, oldest, reconciliation, turnProcessing, finalStats);

  await report(page, onProgress, {
    stage: 'finalization',
    phase: traversalConverged
      ? 'Turn/corpus convergence complete'
      : 'Turn/corpus processing finished with integrity warnings',
    detail: traversalConverged
      ? 'Bidirectional passive discovery, turn-local guarded coverage, scoped disclosure proof, remount verification, targeted semantic revalidation, and reconciliation reached the required fixed point.'
      : 'Crawler processing finished, but one or more convergence invariants did not prove cleanly before a safety limit. Retained content will be finalized with integrity warnings.',
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
    finalExpansion: {
      converged: reconciliation.converged && Number(finalStats.retainedUnresolvedDisclosures || 0) === 0,
      processed: 0,
      reason: reconciliation.converged ? 'logical-disclosure-fixed-point' : 'logical-disclosure-unresolved'
    },
    turnProcessing,
    traversalConverged
  };
}

export const __testing = {
  traversalProgressSignature,
  nextReconciliationStablePasses,
  changedTurnIds
};
