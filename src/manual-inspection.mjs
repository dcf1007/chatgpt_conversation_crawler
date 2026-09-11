import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navigateToRetainedTurn } from './crawler-navigation.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIAGNOSTIC_ROOT = path.join(PROJECT_ROOT, 'manual-inspection-diagnostics');
const MANUAL_POLL_INTERVAL_MS = 250;
const MANUAL_SAFETY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_MANUAL_EVENTS_PER_STEP = 800;
const TARGET_COUNT = 2;

function turnNumber(turnId) {
  return Number(/conversation-turn-(\d+)/.exec(turnId || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function sortTurnIds(turnIds) {
  return [...turnIds].sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
}

function countClosedDetailsInHtml(html) {
  const detailsTags = String(html || '').match(/<details\b[^>]*>/gi) || [];
  return detailsTags.filter(tag => !/\bopen(?:\s|=|>)/i.test(tag)).length;
}

function countReasoningLabelsInHtml(html) {
  const source = String(html || '');
  const labels = source.match(/(?:aria-label\s*=\s*["'][^"']*)?\b(?:Worked for|Thought(?: for)?|Thinking(?: for)?|Reasoning(?: for)?)\b/gi) || [];
  return labels.length;
}

function normalizeTurn(turn) {
  const recognizedCollapsed = Number(turn.remaining || 0);
  const closedDetails = countClosedDetailsInHtml(turn.html);
  const reasoningLabels = countReasoningLabelsInHtml(turn.html);
  const preBlocks = Number(turn.preCount || 0);
  const codeBlocks = Number(turn.codeCount || 0);
  const textLength = Number(turn.textLength || 0);
  const htmlLength = Number(turn.htmlLength || turn.html?.length || 0);
  const assistant = turn.role === 'assistant';

  // Generic aria-expanded=false controls are deliberately absent from this
  // score. Image viewers and menus must not outrank reasoning/tool turns.
  let tier = 0;
  if (assistant && recognizedCollapsed > 0) tier = 5;
  else if (assistant && reasoningLabels > 0) tier = 4;
  else if (assistant && (preBlocks > 0 || codeBlocks > 0)) tier = 3;
  else if (assistant) tier = 2;
  else if (recognizedCollapsed > 0 || reasoningLabels > 0 || preBlocks > 0 || codeBlocks > 0) tier = 1;

  const score =
    tier * 10 ** 15 +
    recognizedCollapsed * 10 ** 11 +
    reasoningLabels * 10 ** 9 +
    preBlocks * 10 ** 6 +
    codeBlocks * 10 ** 4 +
    Math.min(textLength, 9999);

  return {
    ...turn,
    recognizedCollapsed,
    closedDetails,
    reasoningLabels,
    preBlocks,
    codeBlocks,
    textLength,
    htmlLength,
    tier,
    score
  };
}

function reasonForTarget(target) {
  if (target.recognizedCollapsed > 0) {
    return `assistant turn with ${target.recognizedCollapsed} recognized collapsed reasoning/tool disclosure(s)`;
  }
  if (target.reasoningLabels > 0) {
    return `rich assistant reasoning/tool turn (${target.reasoningLabels} reasoning label(s), ${target.preBlocks} pre, ${target.codeBlocks} code)`;
  }
  if (target.preBlocks || target.codeBlocks) {
    return `rich assistant tool/code turn (${target.preBlocks} pre, ${target.codeBlocks} code)`;
  }
  return `largest available assistant turn (${target.textLength} text characters)`;
}

export function selectTargetsFromTurns(turns, { count = TARGET_COUNT, excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds);
  const candidates = (Array.isArray(turns) ? turns : [])
    .filter(turn => turn?.id && !excluded.has(turn.id))
    .map(normalizeTurn)
    .filter(turn => turn.tier > 0)
    .sort((left, right) =>
      right.score - left.score
      || right.htmlLength - left.htmlLength
      || turnNumber(left.id) - turnNumber(right.id)
      || String(left.id).localeCompare(String(right.id))
    );

  return candidates.slice(0, Math.max(0, count)).map(target => ({
    ...target,
    reason: reasonForTarget(target)
  }));
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
    const selector = 'section[data-testid^="conversation-turn-"]';
    const target = document.querySelector(`${selector}[data-testid="${targetId}"]`);
    return {
      targetMounted: Boolean(target),
      targetTextLength: target ? (target.innerText || target.textContent || '').length : 0,
      targetHtmlLength: target ? target.outerHTML.length : 0,
      targetPreBlocks: target?.querySelectorAll('pre').length || 0,
      targetCodeBlocks: target?.querySelectorAll('code').length || 0,
      targetCollapsedControls: target?.querySelectorAll('[aria-expanded="false"]').length || 0,
      targetClosedDetails: target?.querySelectorAll('details:not([open])').length || 0,
      manualInteractionCount: Number(window.__archiveManualInspection?.interactionCount || 0)
    };
  }, targetTurnId).catch(() => ({}));
}

export function buildManualRemountDiagnosticState(target, step) {
  return {
    active: false,
    phase: 'remounting-target',
    stepIndex: Number(step?.index || 0),
    stepCount: Number(step?.count || 0),
    stepLabel: 'Remounting diagnostic target',
    targetTurnId: String(target?.id || ''),
    targetReason: String(target?.reason || ''),
    finishRequested: false,
    interactionCount: 0
  };
}

async function publishManualRemountDiagnosticState(page, target, step) {
  const nextState = buildManualRemountDiagnosticState(target, step);
  await page.evaluate(state => {
    const previous = window.__archiveManualInspection;
    previous?.observer?.disconnect?.();
    if (previous?.clickListener) document.removeEventListener('click', previous.clickListener, true);

    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();
    for (const turn of document.querySelectorAll('[data-archive-manual-inspection-target]')) {
      turn.removeAttribute('data-archive-manual-inspection-target');
    }

    window.__archiveManualInspection = {
      ...state,
      startedAt: new Date().toISOString(),
      events: [],
      observer: null,
      clickListener: null
    };
  }, nextState);
}

async function remountTarget(page, targetTurnId, retainedTurnIds, shouldCancel, onProgress) {
  const result = await navigateToRetainedTurn(page, targetTurnId, retainedTurnIds, {
    shouldCancel,
    onProgress: progress => onProgress?.({
      ...progress,
      phase: 'Remounting diagnostic target',
      detail: `Locating ${targetTurnId} for manual validation using the shared retained-turn navigator.`,
      scanComplete: true
    })
  });
  return {
    ...result,
    strategy: result.found ? result.strategy : 'logical-turn-navigation'
  };
}

async function installManualInspectionUi(page, target, step) {
  await page.evaluate(({ targetTurnId, targetReason, stepIndex, stepCount, maxEvents }) => {
    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();
    const previous = window.__archiveManualInspection;
    previous?.observer?.disconnect?.();
    if (previous?.clickListener) document.removeEventListener('click', previous.clickListener, true);

    const events = [];
    const state = window.__archiveManualInspection = {
      active: true,
      phase: 'manual-inspection',
      stepIndex,
      stepCount,
      stepLabel: 'Crawler-selected regression target',
      targetTurnId,
      targetReason,
      startedAt: new Date().toISOString(),
      finishRequested: false,
      interactionCount: 0,
      events,
      observer: null,
      clickListener: null
    };

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const record = (type, details = {}) => {
      if (events.length < maxEvents) events.push({ at: new Date().toISOString(), type, ...details });
    };
    const labelFor = element => [
      element?.getAttribute?.('aria-label'),
      element?.textContent,
      element?.getAttribute?.('title')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 220);

    const style = document.createElement('style');
    style.id = 'archive-manual-inspection-style';
    style.textContent = `
      [data-archive-manual-inspection-target="true"]{outline:4px solid #f59e0b!important;outline-offset:6px!important}
      #archive-manual-inspection-panel{
        position:fixed;z-index:2147483647;right:18px;top:18px;width:min(460px,calc(100vw - 36px));
        padding:16px;border:2px solid #f59e0b;border-radius:12px;background:#111827;color:#f9fafb;
        font:14px/1.45 system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35)
      }
      #archive-manual-inspection-panel strong{display:block;font-size:16px;margin-bottom:6px}
      #archive-manual-inspection-panel code{color:#fde68a}
      #archive-manual-inspection-panel button{
        margin-top:12px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:#f59e0b;
        color:#111827;font:700 14px system-ui,sans-serif;cursor:pointer
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'archive-manual-inspection-panel';
    panel.innerHTML = `
      <div style="opacity:.72;margin-bottom:8px">Diagnostic step ${stepIndex} of ${stepCount}</div>
      <strong>Manual crawler validation</strong>
      Fully expand the highlighted <code>${targetTurnId}</code> through every nested reasoning/tool layer and wait for leaf content to finish loading.
      <div style="margin-top:8px;opacity:.78">Selected because: ${targetReason}</div>
      <button type="button">This turn is fully expanded</button>`;
    document.body.appendChild(panel);

    for (const turn of document.querySelectorAll('[data-archive-manual-inspection-target]')) {
      turn.removeAttribute('data-archive-manual-inspection-target');
    }
    document.querySelector(`${turnSelector}[data-testid="${targetTurnId}"]`)
      ?.setAttribute('data-archive-manual-inspection-target', 'true');

    panel.querySelector('button').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      state.finishRequested = true;
      state.phase = 'finish-requested';
      record('step-finish-requested', { stepIndex, targetTurnId });
    });

    const clickListener = event => {
      if (!state.active || panel.contains(event.target)) return;
      const interactive = event.target?.closest?.('[aria-expanded],summary,button,[role="button"]');
      const turn = interactive?.closest?.(turnSelector);
      if (!interactive || !turn) return;
      state.interactionCount++;
      const before = interactive.getAttribute('aria-expanded');
      const details = interactive.closest('details');
      const base = {
        interaction: state.interactionCount,
        turnId: turn.getAttribute('data-testid') || '',
        tag: interactive.tagName?.toLowerCase?.() || '',
        label: labelFor(interactive),
        ariaControls: interactive.getAttribute('aria-controls') || '',
        ariaExpandedBefore: before,
        detailsOpenBefore: details ? details.open : null
      };
      record('manual-click', base);
      setTimeout(() => record('manual-click-settled', {
        ...base,
        ariaExpandedAfter: interactive.isConnected ? interactive.getAttribute('aria-expanded') : 'unmounted',
        detailsOpenAfter: details?.isConnected ? details.open : null
      }), 300);
    };
    state.clickListener = clickListener;
    document.addEventListener('click', clickListener, true);

    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (events.length >= maxEvents) break;
        const turn = mutation.target?.closest?.(turnSelector);
        if (!turn) continue;
        if (mutation.type === 'attributes' && ['aria-expanded', 'open'].includes(mutation.attributeName)) {
          record('disclosure-attribute-change', {
            turnId: turn.getAttribute('data-testid') || '',
            attribute: mutation.attributeName,
            label: labelFor(mutation.target),
            value: mutation.target.getAttribute(mutation.attributeName)
          });
        } else if (mutation.type === 'childList' && mutation.addedNodes.length) {
          const interesting = [...mutation.addedNodes].some(node => node instanceof Element && (
            node.matches?.('[aria-expanded],pre,code,iframe,[data-app-block-preview="true"]')
            || node.querySelector?.('[aria-expanded],pre,code,iframe,[data-app-block-preview="true"]')
          ));
          if (interesting) record('nested-content-mounted', { turnId: turn.getAttribute('data-testid') || '', addedNodes: mutation.addedNodes.length });
        }
      }
    });
    state.observer = observer;
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded', 'open'] });
    record('manual-step-started', { stepIndex, targetTurnId, targetReason });
  }, {
    targetTurnId: target.id,
    targetReason: target.reason,
    stepIndex: step.index,
    stepCount: step.count,
    maxEvents: MAX_MANUAL_EVENTS_PER_STEP
  });
}

async function waitForManualFinish(page, shouldCancel) {
  const deadline = Date.now() + MANUAL_SAFETY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    if (page.isClosed()) throw new Error('The ChatGPT browser was closed during manual validation.');
    const requested = await page.evaluate(() => Boolean(window.__archiveManualInspection?.finishRequested)).catch(() => false);
    if (requested) return;
    await page.waitForTimeout(MANUAL_POLL_INTERVAL_MS);
  }
  throw new Error('Manual validation exceeded the 2-hour diagnostic safety limit.');
}

async function stopManualInspectionUi(page) {
  return page.evaluate(() => {
    const state = window.__archiveManualInspection;
    if (!state) return { events: [], interactionCount: 0 };
    state.active = false;
    state.phase = 'manual-step-complete';
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
      stepIndex: state.stepIndex,
      stepCount: state.stepCount,
      targetTurnId: state.targetTurnId,
      targetReason: state.targetReason,
      interactionCount: state.interactionCount,
      events: [...state.events]
    };
  }).catch(() => ({ events: [], interactionCount: 0 }));
}

async function assembleDiagnosticSnapshot(page, sourceUrl) {
  const [{ buildSnapshot, captureArchiveState }, appBlocks, mainImages, { finalizeConversationFidelity }, { evaluateArchiveIntegrity }] = await Promise.all([
    import('./snapshot.mjs'),
    import('./app-blocks.mjs'),
    import('./main-images.mjs'),
    import('./archive-fidelity.mjs'),
    import('./archive-integrity.mjs')
  ]);
  const [archiveState, currentStats] = await Promise.all([
    captureArchiveState(page),
    getCrawlerStats(page)
  ]);
  // Diagnostic snapshots are built before the normal server-side final integrity
  // evaluation. Attach integrity only to this detached clone so diagnostics are
  // truthful without mutating live retained crawler state.
  archiveState.integrity = evaluateArchiveIntegrity(currentStats);
  const preparedImages = await mainImages.prepareMainImages(page, archiveState);
  const preparedEmbeddedContent = await appBlocks.prepareEmbeddedContent(page, {
    embedSvgImages: true,
    archiveState
  });
  let snapshot = await buildSnapshot(page, sourceUrl, { preview: false, archiveState });
  snapshot = appBlocks.finalizeEmbeddedContent(snapshot, preparedEmbeddedContent);
  snapshot = mainImages.finalizeMainImages(snapshot, preparedImages);
  return finalizeConversationFidelity(snapshot);
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function createDiagnosticDirectory() {
  const directory = path.join(MANUAL_DIAGNOSTIC_ROOT, `${timestampForFilename()}-two-step-manual-inspection`);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function writeSnapshot(directory, filename, snapshot) {
  await fs.writeFile(path.join(directory, filename), snapshot.html, 'utf8');
}

async function writeSummary(directory, summary) {
  await fs.writeFile(path.join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function summarizeTarget(target) {
  return {
    id: target.id,
    reason: target.reason,
    role: target.role,
    recognizedCollapsed: target.recognizedCollapsed,
    reasoningLabels: target.reasoningLabels,
    preBlocks: target.preBlocks,
    codeBlocks: target.codeBlocks,
    textLength: target.textLength
  };
}

async function captureManualStep({ page, target, step, retainedTurnIds, diagnosticDirectory, shouldCancel, onProgress, convergeMounted }) {
  await publishManualRemountDiagnosticState(page, target, step);
  const remount = await remountTarget(page, target.id, retainedTurnIds, shouldCancel, onProgress);
  if (!remount.found) {
    const detail = [remount.reason, remount.finalRelation, remount.nearestBeforeId, remount.nearestAfterId].filter(Boolean).join(' · ');
    throw new Error(`Could not remount ${target.id} for manual validation${detail ? ` (${detail})` : ''}.`);
  }

  const beforeMetrics = await getManualPageMetrics(page, target.id);
  await installManualInspectionUi(page, target, step);
  await onProgress?.({
    phase: `Manual inspection step ${step.index}/${step.count}`,
    detail: `Fully expand the highlighted ${target.id} through every nested reasoning/tool layer, wait for leaf content to load, then use the button in the ChatGPT overlay.`,
    scanningStatus: `${target.id} · ${target.reason}`,
    scanComplete: true
  });
  await waitForManualFinish(page, shouldCancel);
  const manualResult = await stopManualInspectionUi(page);
  await page.evaluate(() => window.__archiveCrawler.capture());
  const beforeConvergenceMetrics = await getManualPageMetrics(page, target.id);
  const humanSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, `after-${target.id}-manual-before-reconvergence.html`, humanSnapshot);

  await onProgress?.({
    phase: `Reconciling manual step ${step.index}/${step.count}`,
    detail: `Manual work on ${target.id} is captured. Running the automatic turn-scoped disclosure convergence once more before continuing.`,
    scanningStatus: `${target.id} · ${manualResult.interactionCount} manual interaction(s) · reconverging`,
    scanComplete: true
  });
  await convergeMounted?.();
  await page.evaluate(() => window.__archiveCrawler.capture());
  const afterConvergenceMetrics = await getManualPageMetrics(page, target.id);

  return {
    target: summarizeTarget(target),
    remount,
    beforeMetrics,
    manual: { ...manualResult, targetMetricsBeforeFinalConvergence: beforeConvergenceMetrics },
    afterConvergenceMetrics,
    humanSnapshotStats: humanSnapshot.stats
  };
}

export async function runManualInspection(page, { onProgress, shouldCancel, convergeMounted } = {}) {
  const sessionMode = await getSessionMode(page);
  if (sessionMode !== 'authenticated') {
    await onProgress?.({
      phase: 'Manual diagnostic skipped',
      detail: 'Manual validation is only enabled for the headed authenticated development run. The anonymous automatic crawler uses the same capture routines and continues without a human validation phase.'
    });
    return;
  }

  const retainedTurns = await getRetainedTurns(page);
  if (!retainedTurns.length) {
    await onProgress?.({ phase: 'Manual diagnostic skipped', detail: 'No retained conversation turn was available for manual validation.' });
    return;
  }

  // Select every regression target from the untouched automatic corpus before
  // any human interaction. This keeps step 2 independent from step 1 and makes
  // the diagnostic portable to unrelated conversations.
  const targets = selectTargetsFromTurns(retainedTurns, { count: TARGET_COUNT });
  if (!targets.length) {
    await onProgress?.({ phase: 'Manual diagnostic skipped', detail: 'No suitable reasoning/tool or assistant turn was available for manual validation.' });
    return;
  }

  const diagnosticDirectory = await createDiagnosticDirectory();
  const automaticStats = await getCrawlerStats(page);
  const automaticSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'automatic-before-manual.html', automaticSnapshot);

  const summary = {
    sourceUrl: page.url(),
    sessionMode,
    diagnosticDirectory,
    targetSelection: 'dynamic automatic-corpus ranking; generic collapsed image/menu controls excluded from priority',
    selectedTargets: targets.map(summarizeTarget),
    automatic: { crawlerStats: automaticStats, snapshotStats: automaticSnapshot.stats },
    steps: []
  };
  await onProgress?.({
    phase: 'Saving automatic baseline',
    detail: `Automatic capture is complete. Saved the untouched baseline and selected ${targets.length} independent diagnostic target(s) from that baseline.`,
    scanningStatus: `Automatic capture complete · selected ${targets.map(target => target.id).join(', ')}`,
    scanComplete: true
  });

  const retainedTurnIds = sortTurnIds(retainedTurns.map(turn => turn.id));
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const stepResult = await captureManualStep({
      page,
      target,
      step: { index: index + 1, count: targets.length },
      retainedTurnIds,
      diagnosticDirectory,
      shouldCancel,
      onProgress,
      convergeMounted
    });
    summary.steps.push(stepResult);
  }

  await page.evaluate(() => window.__archiveCrawler.capture());
  const finalStats = await getCrawlerStats(page);
  const postManualSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'post-manual.html', postManualSnapshot);
  summary.postManual = { crawlerStats: finalStats, snapshotStats: postManualSnapshot.stats };
  await writeSummary(diagnosticDirectory, summary);

  const interactions = summary.steps.reduce((total, stepResult) => total + Number(stepResult?.manual?.interactionCount || 0), 0);
  await onProgress?.({
    phase: 'Manual inspection complete',
    detail: `Saved the automatic baseline, ${summary.steps.length} manual validation snapshot(s), post-manual.html, and summary.json under ${path.relative(PROJECT_ROOT, diagnosticDirectory)}. Building the normal final archive next.`,
    scanningStatus: `Manual diagnostic complete · ${interactions} interaction(s) recorded`,
    scanComplete: true
  });
}
