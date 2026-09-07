import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIAGNOSTIC_ROOT = path.join(PROJECT_ROOT, 'manual-inspection-diagnostics');
const MANUAL_POLL_INTERVAL_MS = 250;
const MANUAL_SAFETY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const TARGET_SEARCH_MAX_STEPS = 500;
const TARGET_SEARCH_INTERVAL_MS = 140;
const MAX_MANUAL_EVENTS = 800;

function countCollapsedControlsInHtml(html) {
  return (String(html || '').match(/aria-expanded\s*=\s*["']false["']/gi) || []).length;
}

function countClosedDetailsInHtml(html) {
  const detailsTags = String(html || '').match(/<details\b[^>]*>/gi) || [];
  return detailsTags.filter(tag => !/\bopen(?:\s|=|>)/i.test(tag)).length;
}

/**
 * Pick the turn that gives the manual pass the highest diagnostic value.
 *
 * Priority:
 *   1. a retained turn that still contains collapsed controls;
 *   2. otherwise, the richest assistant/tool turn (pre/code/text content);
 *   3. otherwise, the largest retained turn.
 *
 * This is intentionally a pure function so release CI can regression-test the
 * target-selection policy without launching a browser.
 */
export function selectTargetFromTurns(turns) {
  const normalizedTurns = (Array.isArray(turns) ? turns : [])
    .filter(turn => turn && turn.id)
    .map(turn => {
      const allCollapsedControls = countCollapsedControlsInHtml(turn.html);
      const closedDetails = countClosedDetailsInHtml(turn.html);
      const recognizedCollapsed = Number(turn.remaining || 0);
      const preBlocks = Number(turn.preCount || 0);
      const codeBlocks = Number(turn.codeCount || 0);
      const textLength = Number(turn.textLength || 0);
      const assistantBonus = turn.role === 'assistant' ? 1 : 0;
      const collapsedTotal = allCollapsedControls + closedDetails;

      // Large, separated weights make the policy easy to inspect. Collapsed
      // content always outranks mere richness; richness breaks ties.
      const score =
        (collapsedTotal > 0 ? 10 ** 15 : 0) +
        collapsedTotal * 10 ** 12 +
        recognizedCollapsed * 10 ** 10 +
        assistantBonus * 10 ** 9 +
        preBlocks * 10 ** 6 +
        codeBlocks * 10 ** 4 +
        Math.min(textLength, 9999);

      return {
        ...turn,
        allCollapsedControls,
        closedDetails,
        recognizedCollapsed,
        preBlocks,
        codeBlocks,
        textLength,
        score
      };
    });

  normalizedTurns.sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));
  const target = normalizedTurns[0];
  if (!target) return null;

  const collapsedTotal = target.allCollapsedControls + target.closedDetails;
  let reason;
  if (collapsedTotal > 0) {
    reason = `retained turn still contains ${collapsedTotal} collapsed control(s)`;
  } else if (target.preBlocks || target.codeBlocks) {
    reason = `richest retained tool/code turn (${target.preBlocks} pre, ${target.codeBlocks} code)`;
  } else {
    reason = `largest retained turn (${target.textLength} text characters)`;
  }

  return { ...target, reason };
}

function safeDirectoryPart(value) {
  return String(value || 'manual')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'manual';
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function getSessionMode(page) {
  return page.evaluate(() => window.__archiveCrawlerDevSessionMode || 'unknown').catch(() => 'unknown');
}

async function getRetainedTurns(page) {
  return page.evaluate(() => Object.values(window.__archiveCrawler?.state?.turns || {}).map(turn => ({
    id: turn.id,
    role: turn.role || '',
    remaining: Number(turn.remaining || 0),
    preCount: Number(turn.preCount || 0),
    codeCount: Number(turn.codeCount || 0),
    textLength: Number(turn.textLength || 0),
    htmlLength: Number(turn.htmlLength || turn.html?.length || 0),
    html: turn.html || ''
  })));
}

async function getCrawlerStats(page) {
  return page.evaluate(() => window.__archiveCrawler?.stats?.() || {}).catch(() => ({}));
}

async function getManualPageMetrics(page, targetTurnId) {
  return page.evaluate(targetId => {
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const target = document.querySelector(`${turnSelector}[data-testid="${targetId}"]`);
    const allTurns = [...document.querySelectorAll(turnSelector)];
    const allCollapsedControls = allTurns.reduce(
      (total, turn) => total + turn.querySelectorAll('[aria-expanded="false"]').length,
      0
    );
    const closedDetails = allTurns.reduce(
      (total, turn) => total + turn.querySelectorAll('details:not([open])').length,
      0
    );

    return {
      targetMounted: Boolean(target),
      targetTextLength: target ? (target.innerText || target.textContent || '').length : 0,
      targetHtmlLength: target ? target.outerHTML.length : 0,
      targetPreBlocks: target?.querySelectorAll('pre').length || 0,
      targetCodeBlocks: target?.querySelectorAll('code').length || 0,
      targetCollapsedControls: target?.querySelectorAll('[aria-expanded="false"]').length || 0,
      targetClosedDetails: target?.querySelectorAll('details:not([open])').length || 0,
      allCollapsedControls,
      closedDetails,
      manualInteractionCount: Number(window.__archiveManualInspection?.interactionCount || 0)
    };
  }, targetTurnId).catch(() => ({}));
}

/**
 * Virtualized ChatGPT turns may not exist in the DOM when the automatic crawl
 * ends. Jump near the retained turn's proportional position, then refine using
 * the currently mounted turn numbers until the requested turn is mounted.
 */
async function scrollToRetainedTurn(page, targetTurnId, retainedTurnIds, shouldCancel) {
  const targetIndex = Math.max(0, retainedTurnIds.indexOf(targetTurnId));
  const initialFraction = retainedTurnIds.length <= 1 ? 0 : targetIndex / (retainedTurnIds.length - 1);

  await page.evaluate(fraction => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const maximumTop = Math.max(0, metrics.height - metrics.client);
    crawler.setTop(Math.round(maximumTop * fraction));
  }, initialFraction);
  await page.waitForTimeout(700);

  for (let step = 0; step < TARGET_SEARCH_MAX_STEPS; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    const result = await page.evaluate(targetId => {
      const turnSelector = 'section[data-testid^="conversation-turn-"]';
      const mountedTurns = [...document.querySelectorAll(turnSelector)];
      const target = mountedTurns.find(turn => turn.getAttribute('data-testid') === targetId);
      if (target) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
        return { found: true };
      }

      const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.NaN);
      const targetNumber = turnNumber(targetId);
      const mountedNumbers = mountedTurns
        .map(turn => turnNumber(turn.getAttribute('data-testid')))
        .filter(Number.isFinite);
      const crawler = window.__archiveCrawler;
      const metrics = crawler.metrics();
      const maximumTop = Math.max(0, metrics.height - metrics.client);
      const stepSize = Math.max(320, Math.floor(metrics.client * 0.55));

      let direction = 0;
      if (mountedNumbers.length && Number.isFinite(targetNumber)) {
        const firstMounted = Math.min(...mountedNumbers);
        const lastMounted = Math.max(...mountedNumbers);
        if (targetNumber < firstMounted) direction = -1;
        else if (targetNumber > lastMounted) direction = 1;
        else direction = targetNumber < (firstMounted + lastMounted) / 2 ? -1 : 1;
      } else {
        direction = metrics.top < maximumTop / 2 ? 1 : -1;
      }

      const nextTop = Math.max(0, Math.min(maximumTop, metrics.top + direction * stepSize));
      crawler.setTop(nextTop);
      return { found: false, moved: nextTop !== metrics.top };
    }, targetTurnId);

    if (result.found) {
      await page.waitForTimeout(500);
      return true;
    }
    if (!result.moved) break;
    await page.waitForTimeout(TARGET_SEARCH_INTERVAL_MS);
  }

  return false;
}

async function installManualInspectionUi(page, target) {
  await page.evaluate(({ targetTurnId, targetReason, maxEvents }) => {
    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();

    const existingState = window.__archiveManualInspection;
    if (existingState?.observer) existingState.observer.disconnect();
    if (existingState?.clickListener) document.removeEventListener('click', existingState.clickListener, true);

    const events = [];
    const manualState = {
      active: true,
      phase: 'manual-inspection',
      targetTurnId,
      targetReason,
      startedAt: new Date().toISOString(),
      finishRequested: false,
      interactionCount: 0,
      events,
      observer: null,
      clickListener: null
    };
    window.__archiveManualInspection = manualState;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const labelFor = element => [
      element?.getAttribute?.('aria-label'),
      element?.textContent,
      element?.getAttribute?.('title')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);

    function recordEvent(type, details = {}) {
      if (events.length >= maxEvents) return;
      events.push({ at: new Date().toISOString(), type, ...details });
    }

    function markTargetTurn() {
      for (const turn of document.querySelectorAll('[data-archive-manual-inspection-target]')) {
        turn.removeAttribute('data-archive-manual-inspection-target');
      }
      const targetTurn = document.querySelector(`${turnSelector}[data-testid="${targetTurnId}"]`);
      if (targetTurn) targetTurn.setAttribute('data-archive-manual-inspection-target', 'true');
      return targetTurn;
    }

    const style = document.createElement('style');
    style.id = 'archive-manual-inspection-style';
    style.textContent = `
      [data-archive-manual-inspection-target="true"] {
        outline: 4px solid #f59e0b !important;
        outline-offset: 6px !important;
      }
      #archive-manual-inspection-panel {
        position: fixed;
        z-index: 2147483647;
        right: 18px;
        top: 18px;
        width: min(440px, calc(100vw - 36px));
        padding: 16px;
        border: 2px solid #f59e0b;
        border-radius: 12px;
        background: #111827;
        color: #f9fafb;
        font: 14px/1.45 system-ui, sans-serif;
        box-shadow: 0 18px 50px rgba(0,0,0,.35);
      }
      #archive-manual-inspection-panel strong { display: block; font-size: 16px; margin-bottom: 6px; }
      #archive-manual-inspection-panel code { color: #fde68a; }
      #archive-manual-inspection-panel button {
        margin-top: 12px;
        width: 100%;
        padding: 10px 12px;
        border: 0;
        border-radius: 8px;
        background: #f59e0b;
        color: #111827;
        font: 700 14px system-ui, sans-serif;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'archive-manual-inspection-panel';
    panel.innerHTML = `
      <strong>Manual crawler inspection</strong>
      Fully expand the highlighted <code>${targetTurnId}</code>.
      Open every nested layer and wait for each leaf/tool result to finish loading.
      <div style="margin-top:8px;opacity:.78">Selected because: ${targetReason}</div>
      <button id="archive-manual-inspection-finish" type="button">Finish manual inspection</button>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#archive-manual-inspection-finish').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      manualState.finishRequested = true;
      manualState.phase = 'finish-requested';
      recordEvent('finish-requested');
    });

    const clickListener = event => {
      if (!manualState.active || panel.contains(event.target)) return;
      const interactive = event.target?.closest?.('[aria-expanded],summary,button,[role="button"]');
      const turn = interactive?.closest?.(turnSelector);
      if (!interactive || !turn) return;

      manualState.interactionCount++;
      const beforeExpanded = interactive.getAttribute('aria-expanded');
      const details = interactive.closest('details');
      const eventDetails = {
        interaction: manualState.interactionCount,
        turnId: turn.getAttribute('data-testid') || '',
        tag: interactive.tagName?.toLowerCase?.() || '',
        label: labelFor(interactive),
        ariaControls: interactive.getAttribute('aria-controls') || '',
        ariaExpandedBefore: beforeExpanded,
        detailsOpenBefore: details ? details.open : null
      };
      recordEvent('manual-click', eventDetails);

      setTimeout(() => {
        recordEvent('manual-click-settled', {
          ...eventDetails,
          ariaExpandedAfter: interactive.isConnected ? interactive.getAttribute('aria-expanded') : 'unmounted',
          detailsOpenAfter: details?.isConnected ? details.open : null
        });
      }, 300);
    };
    manualState.clickListener = clickListener;
    document.addEventListener('click', clickListener, true);

    const observer = new MutationObserver(mutations => {
      markTargetTurn();
      for (const mutation of mutations) {
        if (events.length >= maxEvents) break;
        const turn = mutation.target?.closest?.(turnSelector);
        if (!turn) continue;

        if (mutation.type === 'attributes' && ['aria-expanded', 'open'].includes(mutation.attributeName)) {
          recordEvent('disclosure-attribute-change', {
            turnId: turn.getAttribute('data-testid') || '',
            attribute: mutation.attributeName,
            label: labelFor(mutation.target),
            value: mutation.target.getAttribute(mutation.attributeName)
          });
          continue;
        }

        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const interestingAddition = [...mutation.addedNodes].some(node => {
            if (!(node instanceof Element)) return false;
            return node.matches?.('[aria-expanded],pre,code,iframe,[data-app-block-preview="true"]') ||
              Boolean(node.querySelector?.('[aria-expanded],pre,code,iframe,[data-app-block-preview="true"]'));
          });
          if (interestingAddition) {
            recordEvent('nested-content-mounted', {
              turnId: turn.getAttribute('data-testid') || '',
              addedNodes: mutation.addedNodes.length
            });
          }
        }
      }
    });
    manualState.observer = observer;
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'open']
    });

    markTargetTurn();
    recordEvent('manual-inspection-started', { targetTurnId, targetReason });
  }, {
    targetTurnId: target.id,
    targetReason: target.reason,
    maxEvents: MAX_MANUAL_EVENTS
  });
}

async function waitForManualFinish(page, shouldCancel) {
  const deadline = Date.now() + MANUAL_SAFETY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    if (page.isClosed()) throw new Error('The ChatGPT browser was closed during manual inspection.');

    const finishRequested = await page.evaluate(() => Boolean(window.__archiveManualInspection?.finishRequested)).catch(() => false);
    if (finishRequested) return;
    await page.waitForTimeout(MANUAL_POLL_INTERVAL_MS);
  }

  throw new Error('Manual inspection exceeded the 2-hour diagnostic safety limit.');
}

async function stopManualInspectionUi(page) {
  return page.evaluate(() => {
    const state = window.__archiveManualInspection;
    if (!state) return { events: [], interactionCount: 0 };

    state.active = false;
    state.phase = 'manual-inspection-complete';
    state.finishedAt = new Date().toISOString();
    state.observer?.disconnect?.();
    if (state.clickListener) document.removeEventListener('click', state.clickListener, true);

    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();
    for (const turn of document.querySelectorAll('[data-archive-manual-inspection-target]')) {
      turn.removeAttribute('data-archive-manual-inspection-target');
    }

    return {
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      targetTurnId: state.targetTurnId,
      targetReason: state.targetReason,
      interactionCount: state.interactionCount,
      events: [...state.events]
    };
  }).catch(() => ({ events: [], interactionCount: 0 }));
}

async function assembleDiagnosticSnapshot(page, sourceUrl) {
  const [
    { buildSnapshot },
    appBlocks,
    mainImages,
    { finalizeConversationFidelity }
  ] = await Promise.all([
    import('./snapshot.mjs'),
    import('./app-blocks.mjs'),
    import('./main-images.mjs'),
    import('./archive-fidelity.mjs')
  ]);

  await mainImages.captureMountedMainImages(page, { settleMs: 800 }).catch(() => {});
  await appBlocks.captureMountedAppBlocks(page).catch(() => {});

  const preparedImages = await mainImages.prepareMainImages(page);
  const preparedEmbeddedContent = await appBlocks.prepareEmbeddedContent(page, { embedSvgImages: true });
  let snapshot;
  try {
    snapshot = await buildSnapshot(page, sourceUrl, { preview: false, embedImages: true });
  } finally {
    await appBlocks.restoreEmbeddedContent(page, preparedEmbeddedContent);
    await mainImages.restoreMainImages(page, preparedImages);
  }

  snapshot = appBlocks.finalizeEmbeddedContent(snapshot, preparedEmbeddedContent);
  snapshot = mainImages.finalizeMainImages(snapshot, preparedImages);
  return finalizeConversationFidelity(snapshot);
}

async function createDiagnosticDirectory(targetTurnId) {
  const directoryName = `${timestampForFilename()}-${safeDirectoryPart(targetTurnId)}`;
  const directory = path.join(MANUAL_DIAGNOSTIC_ROOT, directoryName);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function writeSnapshot(directory, filename, snapshot) {
  await fs.writeFile(path.join(directory, filename), snapshot.html, 'utf8');
}

async function writeSummary(directory, summary) {
  await fs.writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

export async function runManualInspection(page, { onProgress, shouldCancel, convergeMounted } = {}) {
  const sessionMode = await getSessionMode(page);
  if (sessionMode !== 'authenticated') {
    await onProgress?.({
      phase: 'Manual inspection skipped',
      detail: 'The development manual-inspection pass is only enabled for the headed authenticated browser; anonymous crawling remains headless for public-view fidelity.'
    });
    return;
  }

  const retainedTurns = await getRetainedTurns(page);
  const target = selectTargetFromTurns(retainedTurns);
  if (!target) {
    await onProgress?.({
      phase: 'Manual inspection skipped',
      detail: 'No retained conversation turn was available to inspect manually.'
    });
    return;
  }

  const retainedTurnIds = retainedTurns.map(turn => turn.id).sort((left, right) => {
    const number = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    return number(left) - number(right) || left.localeCompare(right);
  });

  await onProgress?.({
    phase: 'Saving automatic baseline',
    detail: `Automatic beta7 capture is complete. Saving an independent baseline before manual inspection of ${target.id}.`,
    scanningStatus: `Automatic fixed point complete · preparing manual target ${target.id}`,
    scanComplete: true
  });

  const diagnosticDirectory = await createDiagnosticDirectory(target.id);
  const automaticStats = await getCrawlerStats(page);
  const automaticSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'automatic-before-manual.html', automaticSnapshot);

  const targetFound = await scrollToRetainedTurn(page, target.id, retainedTurnIds, shouldCancel);
  if (!targetFound) {
    await writeSummary(diagnosticDirectory, {
      sourceUrl: page.url(),
      target,
      automaticStats,
      automaticSnapshotStats: automaticSnapshot.stats,
      targetFound: false,
      error: 'The retained target turn could not be remounted for manual inspection.'
    });
    throw new Error(`Could not remount ${target.id} for manual inspection.`);
  }

  const baselineTargetMetrics = await getManualPageMetrics(page, target.id);
  await installManualInspectionUi(page, target);

  await onProgress?.({
    phase: 'Manual inspection required',
    detail: `Chromium is paused on ${target.id}. Fully expand the highlighted turn through every nested layer, wait for leaf content to load, then click “Finish manual inspection” in the ChatGPT window.`,
    scanningStatus: `Manual target ${target.id} · ${target.reason}`,
    scanComplete: true
  });

  await waitForManualFinish(page, shouldCancel);
  const manualResult = await stopManualInspectionUi(page);

  // Retain what the user revealed before the automatic algorithm gets another
  // chance to act. This makes the manual delta visible in diagnostics.
  await page.evaluate(() => window.__archiveCrawler.capture());
  const afterManualBeforeConvergence = await getManualPageMetrics(page, target.id);

  await onProgress?.({
    phase: 'Reconciling manual expansion',
    detail: 'Manual inspection finished. Running beta7 fixed-point expansion once more on the mounted range before saving the post-manual result.',
    scanningStatus: `Manual interactions ${manualResult.interactionCount} · reconverging ${target.id}`,
    scanComplete: true
  });

  await convergeMounted?.();
  await page.evaluate(() => window.__archiveCrawler.capture());

  const finalTargetMetrics = await getManualPageMetrics(page, target.id);
  const finalStats = await getCrawlerStats(page);
  const postManualSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'post-manual.html', postManualSnapshot);

  await writeSummary(diagnosticDirectory, {
    sourceUrl: page.url(),
    sessionMode,
    diagnosticDirectory,
    target: {
      id: target.id,
      reason: target.reason,
      role: target.role,
      recognizedCollapsed: target.recognizedCollapsed,
      allCollapsedControlsInRetainedHtml: target.allCollapsedControls,
      closedDetailsInRetainedHtml: target.closedDetails,
      preBlocks: target.preBlocks,
      codeBlocks: target.codeBlocks,
      textLength: target.textLength
    },
    automatic: {
      crawlerStats: automaticStats,
      snapshotStats: automaticSnapshot.stats,
      targetMetrics: baselineTargetMetrics
    },
    manual: {
      ...manualResult,
      targetMetricsBeforeFinalConvergence: afterManualBeforeConvergence
    },
    postManual: {
      crawlerStats: finalStats,
      snapshotStats: postManualSnapshot.stats,
      targetMetrics: finalTargetMetrics
    }
  });

  await onProgress?.({
    phase: 'Manual inspection complete',
    detail: `Saved automatic-before-manual.html, post-manual.html, and summary.json under ${path.relative(PROJECT_ROOT, diagnosticDirectory)}. Building the normal final archive next.`,
    scanningStatus: `Manual inspection complete · ${manualResult.interactionCount} interaction(s) recorded`,
    scanComplete: true
  });
}
