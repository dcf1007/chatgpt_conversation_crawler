import { installCrawler as installBaseCrawler } from './crawler-base.mjs';

const DISCLOSURE_STABLE_SAMPLES = 3;
const DISCLOSURE_SAMPLE_INTERVAL_MS = 120;
const DISCLOSURE_MAX_SETTLE_MS = 3600;
const MOUNTED_STABLE_SAMPLES = 3;
const MOUNTED_SAMPLE_INTERVAL_MS = 120;
const MOUNTED_MAX_SETTLE_MS = 1800;
const QUIESCENT_REQUIRED_ROUNDS = 3;
const QUIESCENT_ROUND_INTERVAL_MS = 180;
const MAX_UNRECOGNIZED_LABELS = 12;

export async function installCrawler(page) {
  await installBaseCrawler(page);
  await page.evaluate(({ requiredRounds, maxLabels }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__beta7DiagnosticsInstalled) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const label = el => [el.getAttribute('aria-label'), el.textContent, el.getAttribute('title')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const turnId = el => el.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const keyFor = el => [turnId(el), el.getAttribute('aria-controls') || '', label(el).slice(0, 240)].join('|');

    function isRecognizedDisclosure(el) {
      if (!(el instanceof HTMLElement) || el.getAttribute('aria-expanded') !== 'false') return false;
      if (el.matches('[aria-haspopup],[role="menuitem"]')) return false;
      if (el.getAttribute('aria-controls')) return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(el));
    }

    function collapsedDiagnostics() {
      let allCollapsedControls = 0;
      let recognizedCollapsed = 0;
      let actionableCollapsed = 0;
      let closedDetails = 0;
      const unrecognizedCollapsedLabels = [];

      for (const section of turns()) {
        const collapsed = [...section.querySelectorAll('[aria-expanded="false"]')];
        allCollapsedControls += collapsed.length;
        for (const el of collapsed) {
          if (isRecognizedDisclosure(el)) {
            recognizedCollapsed++;
            const attempts = Number(crawler.state?.attempts?.[keyFor(el)] || 0);
            if (attempts < 3) actionableCollapsed++;
          } else if (unrecognizedCollapsedLabels.length < maxLabels) {
            const text = label(el).slice(0, 180) || el.tagName?.toLowerCase?.() || 'unlabelled control';
            unrecognizedCollapsedLabels.push(`${turnId(el)} — ${text}`);
          }
        }
        const details = section.querySelectorAll('details:not([open])').length;
        closedDetails += details;
        actionableCollapsed += details;
      }

      return {
        allCollapsedControls,
        recognizedCollapsed,
        actionableCollapsed,
        closedDetails,
        unrecognizedCollapsedLabels
      };
    }

    function mountedQuiescenceSample() {
      const collapsed = collapsedDiagnostics();
      const mountedSignature = crawler.mountedSample();
      const signature = [
        mountedSignature,
        collapsed.allCollapsedControls,
        collapsed.recognizedCollapsed,
        collapsed.actionableCollapsed,
        collapsed.closedDetails,
        collapsed.unrecognizedCollapsedLabels.join('~')
      ].join('|');
      return { ...collapsed, signature };
    }

    crawler.state.expansionGeneration = Number(crawler.state.expansionGeneration || 0);
    crawler.state.quiescence = {
      rounds: 0,
      requiredRounds,
      lastSignature: '',
      converged: false
    };

    crawler.noteExpansionGeneration = () => {
      crawler.state.expansionGeneration++;
      crawler.state.quiescence.rounds = 0;
      crawler.state.quiescence.lastSignature = '';
      crawler.state.quiescence.converged = false;
      return crawler.state.expansionGeneration;
    };
    crawler.markQuiescence = value => {
      crawler.state.quiescence = { ...crawler.state.quiescence, ...value };
    };
    crawler.collapsedDiagnostics = collapsedDiagnostics;
    crawler.mountedQuiescenceSample = mountedQuiescenceSample;

    const baseStats = crawler.stats.bind(crawler);
    crawler.stats = () => {
      const collapsed = collapsedDiagnostics();
      return {
        ...baseStats(),
        ...collapsed,
        expansionGeneration: crawler.state.expansionGeneration,
        quiescentRounds: crawler.state.quiescence.rounds,
        requiredQuiescentRounds: crawler.state.quiescence.requiredRounds,
        quiescenceConverged: crawler.state.quiescence.converged
      };
    };
    crawler.__beta7DiagnosticsInstalled = true;
  }, { requiredRounds: QUIESCENT_REQUIRED_ROUNDS, maxLabels: MAX_UNRECOGNIZED_LABELS });
}

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

async function waitForDisclosureHydration(page, result, shouldCancel) {
  if (!result?.key) return;
  const deadline = Date.now() + DISCLOSURE_MAX_SETTLE_MS;
  let previous = '';
  let stable = 0;

  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const sample = await page.evaluate(key => window.__archiveCrawler.disclosureSample(key), result.key);
    if (sample.expanded && sample.targetExists) {
      stable = sample.signature === previous ? stable + 1 : 1;
      previous = sample.signature;
      if (stable >= DISCLOSURE_STABLE_SAMPLES) return;
    } else {
      stable = 0;
      previous = '';
    }
    await page.waitForTimeout(DISCLOSURE_SAMPLE_INTERVAL_MS);
  }
}

async function stabilizeMounted(page, shouldCancel, maxMs = MOUNTED_MAX_SETTLE_MS) {
  const deadline = Date.now() + maxMs;
  let previous = '';
  let stable = 0;
  let latest = null;

  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    latest = await page.evaluate(() => window.__archiveCrawler.mountedQuiescenceSample());
    stable = latest.signature === previous ? stable + 1 : 1;
    previous = latest.signature;
    if (stable >= MOUNTED_STABLE_SAMPLES) return latest;
    await page.waitForTimeout(MOUNTED_SAMPLE_INTERVAL_MS);
  }
  return latest || page.evaluate(() => window.__archiveCrawler.mountedQuiescenceSample());
}

async function processExpansion(page, result, shouldCancel) {
  await page.evaluate(() => window.__archiveCrawler.noteExpansionGeneration());
  if (result.kind === 'details') {
    await page.waitForTimeout(80);
  } else {
    await waitForDisclosureHydration(page, result, shouldCancel);
    await page.evaluate(key => window.__archiveCrawler.confirm(key), result.key);
  }
  return page.evaluate(() => window.__archiveCrawler.capture());
}

async function expandMounted(page, max, onProgress, shouldCancel) {
  let expandedSinceFullReport = 0;
  let processed = 0;
  let quietRounds = 0;
  let previousQuietSignature = '';

  while (processed < max) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    let result = await page.evaluate(() => window.__archiveCrawler.expandOne());

    if (result) {
      const activity = await processExpansion(page, result, shouldCancel);
      processed++;
      expandedSinceFullReport++;
      quietRounds = 0;
      previousQuietSignature = '';
      await page.evaluate(requiredRounds => window.__archiveCrawler.markQuiescence({
        rounds: 0, requiredRounds, lastSignature: '', converged: false
      }), QUIESCENT_REQUIRED_ROUNDS);

      await onProgress?.({
        ...activity,
        expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
      });
      if (expandedSinceFullReport >= 8) {
        await report(page, onProgress);
        expandedSinceFullReport = 0;
      }
      continue;
    }

    // Fixed-point completion: settle the mounted range, retain any richer DOM,
    // then rescan. A newly mounted nested disclosure starts a new generation.
    const settled = await stabilizeMounted(page, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());
    result = await page.evaluate(() => window.__archiveCrawler.expandOne());
    if (result) {
      const activity = await processExpansion(page, result, shouldCancel);
      processed++;
      expandedSinceFullReport++;
      quietRounds = 0;
      previousQuietSignature = '';
      await onProgress?.({
        ...activity,
        expandingStatus: activity.expandingStatus || 'No disclosure expansion active in current mounted range'
      });
      continue;
    }

    const sample = settled || await page.evaluate(() => window.__archiveCrawler.mountedQuiescenceSample());
    const eligible = Number(sample.actionableCollapsed || 0) === 0;
    if (eligible && sample.signature === previousQuietSignature) quietRounds++;
    else if (eligible) quietRounds = 1;
    else quietRounds = 0;
    previousQuietSignature = sample.signature;

    await page.evaluate(value => window.__archiveCrawler.markQuiescence(value), {
      rounds: quietRounds,
      requiredRounds: QUIESCENT_REQUIRED_ROUNDS,
      lastSignature: sample.signature,
      converged: quietRounds >= QUIESCENT_REQUIRED_ROUNDS
    });

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    await onProgress?.({
      ...stats,
      expandingStatus: quietRounds >= QUIESCENT_REQUIRED_ROUNDS
        ? `Mounted disclosure fixed point reached · ${quietRounds}/${QUIESCENT_REQUIRED_ROUNDS} quiet rounds`
        : `Waiting for nested disclosures · ${quietRounds}/${QUIESCENT_REQUIRED_ROUNDS} quiet rounds · actionable ${stats.actionableCollapsed}`
    });

    if (quietRounds >= QUIESCENT_REQUIRED_ROUNDS) break;
    await page.waitForTimeout(QUIESCENT_ROUND_INTERVAL_MS);
  }

  await stabilizeMounted(page, shouldCancel);
  await page.evaluate(() => window.__archiveCrawler.capture());
  if (expandedSinceFullReport) await report(page, onProgress);
}

async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = 2000) {
  const requiredStableChecks = 6;
  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(
    top => window.__archiveCrawler.setTop(top),
    direction === 'down' ? 0 : Math.max(0, first.height - first.client)
  );
  await page.waitForTimeout(350);

  let stable = 0;
  let previous = '';

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    await expandMounted(page, 180, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const maxTop = Math.max(0, metrics.height - metrics.client);
    const atEnd = direction === 'down' ? metrics.top >= maxTop - 4 : metrics.top <= 4;
    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const signature = [
      Math.round(metrics.top),
      Math.round(metrics.height),
      stats.turns,
      stats.oldestRetained,
      stats.newestRetained,
      stats.mountedFirst,
      stats.mountedLast,
      stats.clicks,
      stats.expanded,
      stats.failures,
      stats.preBlocks,
      stats.codeBlocks,
      stats.timelineMarkers,
      stats.allCollapsedControls,
      stats.recognizedCollapsed,
      stats.actionableCollapsed,
      stats.closedDetails,
      stats.expansionGeneration,
      stats.quiescentRounds
    ].join('|');

    if (atEnd && signature === previous) stable++;
    else if (atEnd) stable = 1;
    else stable = 0;

    const positionPercent = maxTop <= 0 ? 100 : Math.max(0, Math.min(100, (metrics.top / maxTop) * 100));
    const arrow = direction === 'up' ? '↑' : '↓';
    const edgeStatus = atEnd ? ` · edge stable ${Math.min(stable, requiredStableChecks)}/${requiredStableChecks}` : '';

    await onProgress?.({
      ...stats,
      phase: 'Scanning conversation',
      detail: 'Capturing mounted turns, timeline markers, disclosures, and asynchronously hydrated tool content as they appear.',
      scanningStatus: `Pass ${pass}/3 ${arrow} · step ${step + 1}/${maxSteps} · ${positionPercent.toFixed(1)}% mounted range · mounted first ${stats.mountedFirst}${edgeStatus}`,
      scanComplete: false,
      pass,
      direction,
      step: step + 1,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && stable >= requiredStableChecks) break;
    previous = signature;

    const fraction = direction === 'up' ? 0.42 : 0.62;
    const minimumStep = direction === 'up' ? 280 : 320;
    const stepSize = Math.max(minimumStep, Math.floor(metrics.client * fraction));
    const next = direction === 'down'
      ? Math.min(maxTop, metrics.top + stepSize)
      : Math.max(0, metrics.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.setTop(top), next);
    await page.waitForTimeout(direction === 'up' ? 260 : 200);
  }
}

async function verifyOldestMessages(page, onProgress, shouldCancel) {
  const requiredQuietChecks = 12;
  const maxChecks = 180;
  let quietChecks = 0;
  let previousSignature = '';
  let checks = 0;

  await onProgress?.({
    phase: 'Verifying oldest messages',
    detail: 'Live-preview rebuilding is paused while the oldest edge is probed for asynchronously prepended turns.',
    scanningStatus: `Oldest-edge probe · check 0/${maxChecks} · stable 0/${requiredQuietChecks}`,
    scanComplete: false,
    pass: 2,
    direction: 'up',
    step: 0,
    previewPaused: true,
    oldestConverged: null,
    oldestQuietChecks: 0,
    oldestChecks: 0
  });

  for (let check = 0; check < maxChecks; check++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    checks = check + 1;

    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(700);
    await expandMounted(page, 220, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const atTop = metrics.top <= 4;
    const signature = [
      atTop ? 0 : Math.round(metrics.top),
      Math.round(metrics.height),
      stats.turns,
      stats.oldestRetained,
      stats.newestRetained,
      stats.mountedFirst,
      stats.mountedLast,
      stats.preBlocks,
      stats.codeBlocks,
      stats.clicks,
      stats.expanded,
      stats.failures,
      stats.timelineMarkers,
      stats.allCollapsedControls,
      stats.recognizedCollapsed,
      stats.actionableCollapsed,
      stats.closedDetails,
      stats.expansionGeneration,
      stats.quiescentRounds
    ].join('|');

    if (atTop && signature === previousSignature) quietChecks++;
    else quietChecks = 0;
    previousSignature = signature;

    await onProgress?.({
      ...stats,
      phase: 'Verifying oldest messages',
      scanningStatus: `Oldest-edge probe · check ${checks}/${maxChecks} · stable ${quietChecks}/${requiredQuietChecks} · ${atTop ? 'at top' : `offset ${Math.round(metrics.top)}px`} · mounted first ${stats.mountedFirst}`,
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

    if (quietChecks >= requiredQuietChecks) break;

    if (!atTop) {
      await page.waitForTimeout(260);
      await page.evaluate(() => window.__archiveCrawler.setTop(0));
    } else if (quietChecks >= 2) {
      const maxTop = Math.max(0, metrics.height - metrics.client);
      const nudge = Math.min(maxTop, Math.max(220, Math.floor(metrics.client * 0.38)));
      if (nudge > 0) {
        await page.evaluate(top => window.__archiveCrawler.setTop(top), nudge);
        await page.waitForTimeout(260);
        await page.evaluate(() => window.__archiveCrawler.setTop(0));
      }
    }
    await page.waitForTimeout(420);
  }

  const converged = quietChecks >= requiredQuietChecks;
  const result = { converged, quietChecks, checks, requiredQuietChecks, maxChecks };
  await page.evaluate(value => window.__archiveCrawler.markOldestVerification(value), result);

  await report(page, onProgress, {
    phase: converged ? 'Oldest-message verification complete' : 'Oldest-message verification safety limit reached',
    detail: converged
      ? 'The oldest edge converged; preparing the final downward traversal.'
      : `The oldest edge did not reach ${requiredQuietChecks}/${requiredQuietChecks} quiet checks before the ${maxChecks}-check safety limit; continuing with the final downward traversal and recording a warning in the archive.`,
    scanningStatus: converged
      ? `Oldest-edge probe complete · stable ${quietChecks}/${requiredQuietChecks} after ${checks} checks`
      : `Oldest-edge probe safety limit · stable ${quietChecks}/${requiredQuietChecks} after ${checks}/${maxChecks} checks`,
    pass: 2,
    direction: 'up',
    previewPaused: false,
    oldestConverged: converged,
    oldestQuietChecks: quietChecks,
    oldestChecks: checks
  });
  return result;
}

export async function crawlConversation(page, { onProgress, shouldCancel } = {}) {
  await installCrawler(page);
  await report(page, onProgress, {
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

  const traversalSummary = oldest.converged
    ? 'Complete — 3 passes + oldest-edge convergence'
    : `Complete — 3 passes; oldest-edge safety limit (${oldest.quietChecks}/${oldest.requiredQuietChecks} stable)`;

  await onProgress?.({
    phase: 'Final expansion sweep',
    detail: oldest.converged
      ? 'Traversal is complete; opening and stabilizing any disclosures still mounted before the final snapshot.'
      : 'Traversal is complete but the oldest edge hit its safety limit; opening and stabilizing remaining mounted disclosures before the final snapshot.',
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
  await stabilizeMounted(page, shouldCancel, 1800);
  await page.evaluate(() => window.__archiveCrawler.capture());
  await report(page, onProgress, {
    phase: 'Final expansion sweep',
    detail: 'Expansion and hydration sweep complete; preparing the final static page.',
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

export const __testing = { expandMounted, stabilizeMounted, waitForDisclosureHydration };
