import { expandMounted } from './crawler-expansion.mjs';
import { ensurePageForegroundProtection } from './runtime-browser.mjs';

const SCAN_MAX_STEPS = 2000;
const SCAN_ENDPOINT_STABLE_CHECKS = 6;
const OLDEST_REQUIRED_QUIET_CHECKS = 12;
const OLDEST_MAX_CHECKS = 180;
const RECONCILIATION_MAX_PASSES = 2;
const RECONCILIATION_STABLE_PASSES = 1;
const NAVIGATION_STAGNATION_REASSERT = 2;

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

export async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = SCAN_MAX_STEPS) {
  // Keep renderer/activity protection alive without ever activating the native
  // browser window. Navigation state is reset for each traversal phase so a
  // previous direction cannot contaminate the next scan.
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

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
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
      scanningStatus: `Pass ${pass}/3 ${arrow} · step ${step + 1}/${maxSteps} · ${positionPercent.toFixed(1)}% loaded range · mounted first ${stats.mountedFirst}${edgeStatus}`,
      scanComplete: false,
      pass,
      direction,
      step: step + 1,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && stableChecks >= SCAN_ENDPOINT_STABLE_CHECKS) break;
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
    pass: 2,
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
    await expandMounted(page, 220, onProgress, shouldCancel);
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
      pass: 2,
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
      const maximumTop = Math.max(0, metrics.height - metrics.client);
      const nudge = Math.min(maximumTop, Math.max(220, Math.floor(metrics.client * 0.38)));
      if (nudge > 0) {
        // Endpoint verification deliberately uses exact positioning. The
        // beta14.2 global wrapper turned this probe into an adaptive move and
        // allowed zoom-dependent navigation state to leak into convergence.
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
      ? 'The oldest edge converged; preparing the final downward traversal.'
      : `The oldest edge did not reach ${OLDEST_REQUIRED_QUIET_CHECKS}/${OLDEST_REQUIRED_QUIET_CHECKS} quiet checks before the ${OLDEST_MAX_CHECKS}-check safety limit; continuing with the final downward traversal and recording a warning in the archive.`,
    scanningStatus: converged
      ? `Oldest-edge probe complete · stable ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks} checks`
      : `Oldest-edge probe safety limit · stable ${quietChecks}/${OLDEST_REQUIRED_QUIET_CHECKS} after ${checks}/${OLDEST_MAX_CHECKS} checks`,
    pass: 2,
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

function rewriteReconciliationProgress(onProgress, round, direction) {
  if (!onProgress) return undefined;
  const arrow = direction === 'up' ? '↑' : '↓';
  return progress => {
    const rawStatus = String(progress?.scanningStatus || '');
    const scanStatus = rawStatus.replace(/^Pass 3\/3\s*[↑↓]\s*·\s*/, '').replace(/^Pass 3\/3\s*/, '');
    return onProgress({
      ...progress,
      stage: 'reconciliation',
      phase: 'Reconciling retained disclosures',
      detail: 'Rich retained turns still contain recognized collapsed disclosures. Revisiting them with turn-scoped convergence.',
      scanningStatus: `Reconciliation ${round}/${RECONCILIATION_MAX_PASSES} ${arrow} · ${scanStatus || 'expanding mounted disclosures'}`,
      scanComplete: false,
      pass: 0
    });
  };
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
    const direction = round % 2 === 1 ? 'down' : 'up';
    const progress = rewriteReconciliationProgress(onProgress, round, direction);
    await page.evaluate(value => window.__archiveCrawler.markReconciliation(value), { converged: false, rounds: round, stablePasses });
    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    await onProgress?.({
      ...stats,
      stage: 'reconciliation',
      phase: 'Reconciling retained disclosures',
      detail: 'The retained corpus still contains disclosures captured collapsed. A turn-scoped reconciliation traversal will revisit them; an unchanged retained fingerprint stops the safety pass.',
      scanningStatus: `Reconciliation ${round}/${RECONCILIATION_MAX_PASSES} · ${summary.retainedUnresolvedTurns} unresolved turn(s), ${summary.retainedUnresolvedDisclosures} disclosure(s)`,
      scanComplete: false,
      pass: 0,
      direction,
      step: 0
    });

    await scan(page, direction, 3, progress, shouldCancel);
    summary = await retainedDisclosureSummary(page);
    if (summary.fingerprint === previousFingerprint) stablePasses++;
    else stablePasses = 0;
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
      ? `All retained recognized disclosures converged after ${rounds} reconciliation pass(es).`
      : `Reconciliation stopped after ${rounds} pass(es) with ${result.unresolvedTurns} retained turn(s) and ${result.unresolvedDisclosures} disclosure(s) still flagged. Their richest captured versions are preserved and the limitation is reported.`,
    scanningStatus: result.converged
      ? `Retained disclosure corpus converged · ${rounds} pass(es)`
      : `Retained reconciliation stopped · ${result.unresolvedTurns} turn(s) / ${result.unresolvedDisclosures} disclosure(s) remain`,
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0
  });
  return result;
}

export async function crawlAutomaticConversation(page, { onProgress, shouldCancel } = {}) {
  await report(page, onProgress, {
    stage: 'preparing',
    phase: 'Preparing crawler',
    detail: 'Installed page-side capture helpers; preparing the first traversal.',
    scanningStatus: 'Not started',
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false
  });

  await scan(page, 'down', 1, onProgress, shouldCancel);
  await scan(page, 'up', 2, onProgress, shouldCancel);
  const oldest = await verifyOldestMessages(page, onProgress, shouldCancel);
  await scan(page, 'down', 3, onProgress, shouldCancel);
  const reconciliation = await reconcileRetainedDisclosures(page, onProgress, shouldCancel);

  const traversalBase = oldest.converged
    ? 'Complete — 3 passes + oldest-edge convergence'
    : `Complete — 3 passes; oldest-edge safety limit (${oldest.quietChecks}/${oldest.requiredQuietChecks} stable)`;
  const traversalSummary = reconciliation.rounds > 0
    ? `${traversalBase}; retained reconciliation ${reconciliation.converged ? 'converged' : 'stopped'} after ${reconciliation.rounds} pass(es)`
    : traversalBase;

  await onProgress?.({
    stage: 'finalization',
    phase: 'Final expansion sweep',
    detail: oldest.converged
      ? 'Traversal and retained-corpus reconciliation are complete; opening any disclosures still mounted before the final snapshot.'
      : 'Traversal reached the oldest-edge safety limit; remaining mounted disclosures are being checked before the final snapshot.',
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

  await expandMounted(page, 500, onProgress, shouldCancel);
  await page.evaluate(() => window.__archiveCrawler.capture());
  await report(page, onProgress, {
    stage: 'finalization',
    phase: 'Final expansion sweep',
    detail: 'Expansion, hydration, and retained-disclosure reconciliation are complete; preparing the final static page.',
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
}

export const __testing = { traversalProgressSignature, NAVIGATION_STAGNATION_REASSERT };
