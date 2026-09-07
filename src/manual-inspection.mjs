import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANUAL_DIAGNOSTIC_ROOT = path.join(PROJECT_ROOT, 'manual-inspection-diagnostics');
const MANUAL_POLL_INTERVAL_MS = 250;
const MANUAL_SAFETY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MAX_MANUAL_EVENTS_PER_STEP = 800;

// Manual target remounting is deliberately separate from the automatic crawler.
// ChatGPT's virtualizer can change scrollTop after a programmatic scroll in
// order to preserve a visual anchor. Therefore target search must never assume
// that an immediate scrollTop assignment is durable or that mountedFirst /
// mountedLast describe a contiguous set of turns.
const REMOUNT_TOP_MAX_ATTEMPTS = 80;
const REMOUNT_TOP_STABLE_ROUNDS = 2;
const REMOUNT_TOP_INTERVAL_MS = 220;
const REMOUNT_SWEEP_FRACTIONS = Object.freeze([0.50, 0.28, 0.14, 0.08]);
const REMOUNT_SWEEP_MAX_STEPS = 650;
const REMOUNT_SWEEP_INTERVAL_MS = 170;
const REMOUNT_BRACKET_PROBES = 16;
const REMOUNT_BRACKET_INTERVAL_MS = 160;
const REMOUNT_TARGET_SETTLE_MS = 500;
const REMOUNT_STALL_LIMIT = 8;

export const KNOWN_PROBLEM_TURN_ID = 'conversation-turn-54';

function countCollapsedControlsInHtml(html) {
  return (String(html || '').match(/aria-expanded\s*=\s*["']false["']/gi) || []).length;
}

function countClosedDetailsInHtml(html) {
  const detailsTags = String(html || '').match(/<details\b[^>]*>/gi) || [];
  return detailsTags.filter(tag => !/\bopen(?:\s|=|>)/i.test(tag)).length;
}

function normalizeTurn(turn) {
  const allCollapsedControls = countCollapsedControlsInHtml(turn.html);
  const closedDetails = countClosedDetailsInHtml(turn.html);
  const recognizedCollapsed = Number(turn.remaining || 0);
  const preBlocks = Number(turn.preCount || 0);
  const codeBlocks = Number(turn.codeCount || 0);
  const textLength = Number(turn.textLength || 0);
  const assistantBonus = turn.role === 'assistant' ? 1 : 0;
  const collapsedTotal = allCollapsedControls + closedDetails;

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
}

function reasonForTarget(target) {
  const collapsedTotal = target.allCollapsedControls + target.closedDetails;
  if (collapsedTotal > 0) {
    return `retained turn still contains ${collapsedTotal} collapsed control(s)`;
  }
  if (target.preBlocks || target.codeBlocks) {
    return `richest retained tool/code turn (${target.preBlocks} pre, ${target.codeBlocks} code)`;
  }
  return `largest retained turn (${target.textLength} text characters)`;
}

/** Select the crawler's preferred independent diagnostic target. */
export function selectTargetFromTurns(turns, { excludeIds = [] } = {}) {
  const excluded = new Set(excludeIds);
  const candidates = (Array.isArray(turns) ? turns : [])
    .filter(turn => turn?.id && !excluded.has(turn.id))
    .map(normalizeTurn)
    .sort((left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)));

  const target = candidates[0];
  return target ? { ...target, reason: reasonForTarget(target) } : null;
}

/** Select the fixed first target used for the known turn-54 comparison. */
export function selectKnownProblemTarget(turns, turnId = KNOWN_PROBLEM_TURN_ID) {
  const match = (Array.isArray(turns) ? turns : []).find(turn => turn?.id === turnId);
  if (!match) return null;
  const normalized = normalizeTurn(match);
  return {
    ...normalized,
    reason: 'known problematic turn from the independent manual MHTML comparison'
  };
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function turnNumber(turnId) {
  return Number(/conversation-turn-(\d+)/.exec(turnId || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function sortTurnIds(turnIds) {
  return [...turnIds].sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
}

/**
 * Classify the ACTUAL mounted turn set relative to a retained target.
 *
 * This intentionally does not infer continuity from the smallest/largest
 * mounted turn number. A virtualized DOM can contain turns 37 and 39 while 38
 * is absent. In that case the target is bracketed, not "above" or "below" a
 * fictitious contiguous mounted range.
 */
export function analyzeRemountWindow(retainedTurnIds, mountedTurnIds, targetTurnId) {
  const retained = Array.isArray(retainedTurnIds) ? retainedTurnIds : [];
  const mounted = Array.isArray(mountedTurnIds) ? mountedTurnIds : [];
  const order = new Map(retained.map((id, index) => [id, index]));
  const targetIndex = order.has(targetTurnId) ? order.get(targetTurnId) : -1;

  const mountedInOrder = mounted
    .filter(id => order.has(id))
    .map(id => ({ id, index: order.get(id) }))
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));

  const targetMounted = mounted.includes(targetTurnId);
  const before = targetIndex >= 0
    ? mountedInOrder.filter(entry => entry.index < targetIndex).at(-1) || null
    : null;
  const after = targetIndex >= 0
    ? mountedInOrder.find(entry => entry.index > targetIndex) || null
    : null;

  let relation = 'unknown';
  if (targetMounted) relation = 'mounted';
  else if (before && after) relation = 'bracketed';
  else if (before) relation = 'before-target';
  else if (after) relation = 'after-target';

  return {
    targetIndex,
    targetMounted,
    relation,
    nearestBeforeId: before?.id || '',
    nearestBeforeIndex: before?.index ?? -1,
    nearestAfterId: after?.id || '',
    nearestAfterIndex: after?.index ?? -1,
    lowestMountedIndex: mountedInOrder[0]?.index ?? -1,
    highestMountedIndex: mountedInOrder.at(-1)?.index ?? -1,
    mountedCount: mountedInOrder.length
  };
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

    return {
      targetMounted: Boolean(target),
      targetTextLength: target ? (target.innerText || target.textContent || '').length : 0,
      targetHtmlLength: target ? target.outerHTML.length : 0,
      targetPreBlocks: target?.querySelectorAll('pre').length || 0,
      targetCodeBlocks: target?.querySelectorAll('code').length || 0,
      targetCollapsedControls: target?.querySelectorAll('[aria-expanded="false"]').length || 0,
      targetClosedDetails: target?.querySelectorAll('details:not([open])').length || 0,
      allCollapsedControls: allTurns.reduce(
        (total, turn) => total + turn.querySelectorAll('[aria-expanded="false"]').length,
        0
      ),
      closedDetails: allTurns.reduce(
        (total, turn) => total + turn.querySelectorAll('details:not([open])').length,
        0
      ),
      manualInteractionCount: Number(window.__archiveManualInspection?.interactionCount || 0)
    };
  }, targetTurnId).catch(() => ({}));
}

async function sampleRemountState(page, targetTurnId) {
  return page.evaluate(targetId => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const mountedIds = [...document.querySelectorAll(turnSelector)]
      .map(turn => turn.getAttribute('data-testid'))
      .filter(Boolean);
    return {
      found: mountedIds.includes(targetId),
      mountedIds,
      top: Number(metrics.top || 0),
      height: Number(metrics.height || 0),
      client: Number(metrics.client || 0)
    };
  }, targetTurnId);
}

async function focusMountedTarget(page, targetTurnId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const existed = await page.evaluate(targetId => {
      const target = document.querySelector(`section[data-testid="${targetId}"]`);
      if (!target) return false;
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    }, targetTurnId);
    if (!existed) return false;
    await page.waitForTimeout(attempt === 0 ? REMOUNT_TARGET_SETTLE_MS : 220);
    const state = await sampleRemountState(page, targetTurnId);
    if (state.found) return true;
  }
  return false;
}

async function acquireTopEdge(page, targetTurnId, shouldCancel) {
  let stableAtTop = 0;
  let lastState = await sampleRemountState(page, targetTurnId);

  for (let attempt = 0; attempt < REMOUNT_TOP_MAX_ATTEMPTS; attempt++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    if (lastState.found) return { acquired: true, found: true, attempts: attempt, state: lastState };

    if (lastState.top <= 4) stableAtTop++;
    else stableAtTop = 0;

    if (stableAtTop >= REMOUNT_TOP_STABLE_ROUNDS) {
      return { acquired: true, found: false, attempts: attempt, state: lastState };
    }

    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(REMOUNT_TOP_INTERVAL_MS);
    lastState = await sampleRemountState(page, targetTurnId);
  }

  return { acquired: false, found: lastState.found, attempts: REMOUNT_TOP_MAX_ATTEMPTS, state: lastState };
}

async function probeBracketedTarget(page, targetTurnId, retainedTurnIds, analysis, shouldCancel) {
  if (!analysis.nearestBeforeId) return { found: false, probes: 0 };

  await page.evaluate(beforeId => {
    const before = document.querySelector(`section[data-testid="${beforeId}"]`);
    before?.scrollIntoView({ block: 'end', inline: 'nearest' });
  }, analysis.nearestBeforeId);
  await page.waitForTimeout(260);

  for (let probe = 0; probe < REMOUNT_BRACKET_PROBES; probe++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const state = await sampleRemountState(page, targetTurnId);
    if (state.found && await focusMountedTarget(page, targetTurnId)) {
      return { found: true, probes: probe + 1 };
    }

    const current = analyzeRemountWindow(retainedTurnIds, state.mountedIds, targetTurnId);
    if (current.relation === 'after-target') break;

    const maximumTop = Math.max(0, state.height - state.client);
    const microStep = Math.max(72, Math.min(180, Math.floor(state.client * 0.10)));
    const nextTop = Math.min(maximumTop, state.top + microStep);
    if (nextTop <= state.top + 1) break;
    await page.evaluate(top => window.__archiveCrawler.setTop(top), nextTop);
    await page.waitForTimeout(REMOUNT_BRACKET_INTERVAL_MS);
  }

  return { found: false, probes: REMOUNT_BRACKET_PROBES };
}

async function anchorNearestPredecessor(page, beforeId) {
  if (!beforeId) return false;
  return page.evaluate(id => {
    const before = document.querySelector(`section[data-testid="${id}"]`);
    if (!before) return false;
    before.scrollIntoView({ block: 'end', inline: 'nearest' });
    return true;
  }, beforeId);
}

async function scrollToRetainedTurn(page, targetTurnId, retainedTurnIds, shouldCancel, onProgress) {
  const targetIndex = retainedTurnIds.indexOf(targetTurnId);
  if (targetIndex < 0) {
    return { found: false, reason: 'target-not-in-retained-order', targetTurnId };
  }

  let state = await sampleRemountState(page, targetTurnId);
  if (state.found && await focusMountedTarget(page, targetTurnId)) {
    return { found: true, strategy: 'already-mounted', sweeps: 0, steps: 0 };
  }

  let analysis = analyzeRemountWindow(retainedTurnIds, state.mountedIds, targetTurnId);
  if (analysis.relation === 'bracketed') {
    const bracket = await probeBracketedTarget(page, targetTurnId, retainedTurnIds, analysis, shouldCancel);
    if (bracket.found) {
      return {
        found: true,
        strategy: 'bracketed-predecessor-anchor',
        sweeps: 0,
        steps: bracket.probes,
        nearestBeforeId: analysis.nearestBeforeId,
        nearestAfterId: analysis.nearestAfterId
      };
    }
    state = await sampleRemountState(page, targetTurnId);
    analysis = analyzeRemountWindow(retainedTurnIds, state.mountedIds, targetTurnId);
  }

  let startFromCurrent = analysis.relation === 'before-target';
  let totalSteps = 0;
  let topAcquisitions = 0;
  let lastFailure = '';

  for (let sweep = 0; sweep < REMOUNT_SWEEP_FRACTIONS.length; sweep++) {
    const baseFraction = REMOUNT_SWEEP_FRACTIONS[sweep];

    if (!startFromCurrent || sweep > 0) {
      const edge = await acquireTopEdge(page, targetTurnId, shouldCancel);
      topAcquisitions++;
      if (edge.found && await focusMountedTarget(page, targetTurnId)) {
        return { found: true, strategy: 'top-edge-acquisition', sweeps: sweep + 1, steps: totalSteps, topAcquisitions };
      }
      if (!edge.acquired) {
        lastFailure = `could-not-acquire-top-edge-after-${edge.attempts}-attempts`;
        continue;
      }
    }
    startFromCurrent = false;

    let stallCount = 0;
    for (let step = 0; step < REMOUNT_SWEEP_MAX_STEPS; step++) {
      if (shouldCancel?.()) throw new Error('Archive cancelled.');
      totalSteps++;

      state = await sampleRemountState(page, targetTurnId);
      if (state.found && await focusMountedTarget(page, targetTurnId)) {
        return { found: true, strategy: 'monotonic-forward-sweep', sweeps: sweep + 1, steps: totalSteps, topAcquisitions };
      }

      analysis = analyzeRemountWindow(retainedTurnIds, state.mountedIds, targetTurnId);
      if (analysis.relation === 'bracketed') {
        const bracket = await probeBracketedTarget(page, targetTurnId, retainedTurnIds, analysis, shouldCancel);
        totalSteps += bracket.probes;
        if (bracket.found) {
          return {
            found: true,
            strategy: 'forward-sweep-bracket-anchor',
            sweeps: sweep + 1,
            steps: totalSteps,
            topAcquisitions,
            nearestBeforeId: analysis.nearestBeforeId,
            nearestAfterId: analysis.nearestAfterId
          };
        }
        state = await sampleRemountState(page, targetTurnId);
        analysis = analyzeRemountWindow(retainedTurnIds, state.mountedIds, targetTurnId);
      }

      if (analysis.relation === 'after-target') {
        lastFailure = `sweep-${sweep + 1}-overshot-target`;
        break;
      }

      const maximumTop = Math.max(0, state.height - state.client);
      if (maximumTop <= 0 || state.top >= maximumTop - 2) {
        lastFailure = `sweep-${sweep + 1}-reached-bottom`;
        break;
      }

      let fraction = baseFraction;
      if (analysis.nearestBeforeIndex >= 0) {
        const remainingTurns = targetIndex - analysis.nearestBeforeIndex;
        if (remainingTurns <= 8) fraction = Math.min(fraction, 0.24);
        if (remainingTurns <= 3) fraction = Math.min(fraction, 0.12);
      }

      const stepSize = Math.max(96, Math.floor(state.client * fraction));
      const requestedTop = Math.min(maximumTop, state.top + stepSize);
      await page.evaluate(top => window.__archiveCrawler.setTop(top), requestedTop);
      await page.waitForTimeout(REMOUNT_SWEEP_INTERVAL_MS);

      const post = await sampleRemountState(page, targetTurnId);
      const postAnalysis = analyzeRemountWindow(retainedTurnIds, post.mountedIds, targetTurnId);
      const mountedOrderProgress = postAnalysis.nearestBeforeIndex > analysis.nearestBeforeIndex;
      const actualScrollProgress = post.top > state.top + 12;
      const progress = post.found || mountedOrderProgress || actualScrollProgress;
      stallCount = progress ? 0 : stallCount + 1;

      if (step % 20 === 0) {
        await onProgress?.({
          phase: 'Remounting manual inspection target',
          detail: `Locating ${targetTurnId} with a forward-only virtualizer sweep (${sweep + 1}/${REMOUNT_SWEEP_FRACTIONS.length}).`,
          scanningStatus: `Remount ${targetTurnId} · sweep ${sweep + 1} · step ${step + 1} · mounted before ${postAnalysis.nearestBeforeId || 'none'} · after ${postAnalysis.nearestAfterId || 'none'}`,
          scanComplete: true
        });
      }

      if (post.found && await focusMountedTarget(page, targetTurnId)) {
        return { found: true, strategy: 'monotonic-forward-sweep', sweeps: sweep + 1, steps: totalSteps, topAcquisitions };
      }

      if (stallCount >= REMOUNT_STALL_LIMIT) {
        const anchored = await anchorNearestPredecessor(page, postAnalysis.nearestBeforeId);
        if (anchored) await page.waitForTimeout(260);
        stallCount = 0;
      }
    }
  }

  const finalState = await sampleRemountState(page, targetTurnId);
  const finalAnalysis = analyzeRemountWindow(retainedTurnIds, finalState.mountedIds, targetTurnId);
  return {
    found: false,
    strategy: 'monotonic-forward-sweep',
    reason: lastFailure || 'target-never-mounted',
    sweeps: REMOUNT_SWEEP_FRACTIONS.length,
    steps: totalSteps,
    topAcquisitions,
    finalTop: Math.round(finalState.top),
    finalHeight: Math.round(finalState.height),
    finalRelation: finalAnalysis.relation,
    nearestBeforeId: finalAnalysis.nearestBeforeId,
    nearestAfterId: finalAnalysis.nearestAfterId
  };
}

async function installManualInspectionUi(page, target, step) {
  await page.evaluate(({ targetTurnId, targetReason, stepIndex, stepCount, stepLabel, buttonLabel, maxEvents }) => {
    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();

    const existingState = window.__archiveManualInspection;
    existingState?.observer?.disconnect?.();
    if (existingState?.clickListener) {
      document.removeEventListener('click', existingState.clickListener, true);
    }

    const events = [];
    const manualState = {
      active: true,
      phase: 'manual-inspection',
      stepIndex,
      stepCount,
      stepLabel,
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
        width: min(460px, calc(100vw - 36px));
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
      #archive-manual-inspection-panel .archive-manual-step { opacity: .72; margin-bottom: 8px; }
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
      <div class="archive-manual-step">Step ${stepIndex} of ${stepCount} · ${stepLabel}</div>
      <strong>Manual crawler inspection</strong>
      Fully expand the highlighted <code>${targetTurnId}</code>.
      Open every nested layer and wait for every leaf/tool result to finish loading.
      <div style="margin-top:8px;opacity:.78">Selected because: ${targetReason}</div>
      <button id="archive-manual-inspection-finish" type="button">${buttonLabel}</button>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#archive-manual-inspection-finish').addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      manualState.finishRequested = true;
      manualState.phase = stepIndex < stepCount ? 'step-complete-requested' : 'finish-requested';
      recordEvent('step-finish-requested', { stepIndex, stepLabel });
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
    recordEvent('manual-step-started', { stepIndex, stepLabel, targetTurnId, targetReason });
  }, {
    targetTurnId: target.id,
    targetReason: target.reason,
    stepIndex: step.index,
    stepCount: step.count,
    stepLabel: step.label,
    buttonLabel: step.buttonLabel,
    maxEvents: MAX_MANUAL_EVENTS_PER_STEP
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
      stepLabel: state.stepLabel,
      targetTurnId: state.targetTurnId,
      targetReason: state.targetReason,
      interactionCount: state.interactionCount,
      events: [...state.events]
    };
  }).catch(() => ({ events: [], interactionCount: 0 }));
}

async function assembleDiagnosticSnapshot(page, sourceUrl) {
  const [{ buildSnapshot }, appBlocks, mainImages, { finalizeConversationFidelity }] = await Promise.all([
    import('./snapshot.mjs'), import('./app-blocks.mjs'), import('./main-images.mjs'), import('./archive-fidelity.mjs')
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

async function createDiagnosticDirectory() {
  const directoryName = `${timestampForFilename()}-two-step-manual-inspection`;
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

function summarizeTarget(target) {
  if (!target) return null;
  return {
    id: target.id,
    reason: target.reason,
    role: target.role,
    recognizedCollapsed: target.recognizedCollapsed,
    allCollapsedControlsInRetainedHtml: target.allCollapsedControls,
    closedDetailsInRetainedHtml: target.closedDetails,
    preBlocks: target.preBlocks,
    codeBlocks: target.codeBlocks,
    textLength: target.textLength
  };
}

async function captureManualStep({ page, target, step, retainedTurnIds, diagnosticDirectory, shouldCancel, onProgress, convergeMounted, snapshotFilename }) {
  const remount = await scrollToRetainedTurn(page, target.id, retainedTurnIds, shouldCancel, onProgress);
  if (!remount.found) {
    const detail = [remount.reason, remount.finalRelation, remount.nearestBeforeId, remount.nearestAfterId].filter(Boolean).join(' · ');
    throw new Error(`Could not remount ${target.id} for manual inspection${detail ? ` (${detail})` : ''}.`);
  }

  const beforeMetrics = await getManualPageMetrics(page, target.id);
  await installManualInspectionUi(page, target, step);
  await onProgress?.({
    phase: `Manual inspection step ${step.index}/${step.count}`,
    detail: `Chromium is paused on ${target.id}. Fully expand the highlighted turn through every nested layer, wait for leaf content to load, then use the button in the ChatGPT overlay.`,
    scanningStatus: `${step.label} · ${target.id} · ${target.reason}`,
    scanComplete: true
  });
  await waitForManualFinish(page, shouldCancel);
  const manualResult = await stopManualInspectionUi(page);
  await page.evaluate(() => window.__archiveCrawler.capture());
  const afterManualBeforeConvergence = await getManualPageMetrics(page, target.id);
  const humanSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, snapshotFilename, humanSnapshot);
  await onProgress?.({
    phase: `Reconciling manual step ${step.index}/${step.count}`,
    detail: `Manual work on ${target.id} is captured. Running beta7 fixed-point convergence on the mounted range before moving on.`,
    scanningStatus: `${step.label} · ${manualResult.interactionCount} manual interaction(s) · reconverging`,
    scanComplete: true
  });
  await convergeMounted?.();
  await page.evaluate(() => window.__archiveCrawler.capture());
  const afterConvergenceMetrics = await getManualPageMetrics(page, target.id);
  return {
    target: summarizeTarget(target),
    remount,
    beforeMetrics,
    manual: { ...manualResult, targetMetricsBeforeFinalConvergence: afterManualBeforeConvergence },
    afterConvergenceMetrics,
    humanSnapshotStats: humanSnapshot.stats
  };
}

export async function runManualInspection(page, { onProgress, shouldCancel, convergeMounted } = {}) {
  const sessionMode = await getSessionMode(page);
  if (sessionMode !== 'authenticated') {
    await onProgress?.({ phase: 'Manual inspection skipped', detail: 'The two-step manual pass is only enabled for the headed authenticated browser; anonymous crawling remains headless for public-view fidelity.' });
    return;
  }
  let retainedTurns = await getRetainedTurns(page);
  if (!retainedTurns.length) {
    await onProgress?.({ phase: 'Manual inspection skipped', detail: 'No retained conversation turn was available to inspect manually.' });
    return;
  }

  const diagnosticDirectory = await createDiagnosticDirectory();
  const automaticStats = await getCrawlerStats(page);
  const automaticSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'automatic-before-manual.html', automaticSnapshot);
  const summary = {
    sourceUrl: page.url(), sessionMode, diagnosticDirectory, knownProblemTurnId: KNOWN_PROBLEM_TURN_ID,
    automatic: { crawlerStats: automaticStats, snapshotStats: automaticSnapshot.stats }, steps: []
  };
  await onProgress?.({
    phase: 'Saving automatic baseline',
    detail: `Automatic beta7 capture is complete. Saved the baseline; preparing known problem turn ${KNOWN_PROBLEM_TURN_ID}.`,
    scanningStatus: `Automatic fixed point complete · preparing ${KNOWN_PROBLEM_TURN_ID}`,
    scanComplete: true
  });

  const retainedTurnIds = sortTurnIds(retainedTurns.map(turn => turn.id));
  const knownProblemTarget = selectKnownProblemTarget(retainedTurns);
  if (knownProblemTarget) {
    const knownStepResult = await captureManualStep({
      page, target: knownProblemTarget,
      step: { index: 1, count: 2, label: 'Known problem turn', buttonLabel: 'Turn 54 is fully expanded — continue to step 2' },
      retainedTurnIds, diagnosticDirectory, shouldCancel, onProgress, convergeMounted,
      snapshotFilename: 'after-turn-54-manual-before-reconvergence.html'
    });
    summary.steps.push(knownStepResult);
  } else {
    summary.steps.push({ target: { id: KNOWN_PROBLEM_TURN_ID, reason: 'known problematic turn from prior MHTML comparison' }, skipped: true, error: `${KNOWN_PROBLEM_TURN_ID} was not present in the retained automatic crawl.` });
    await onProgress?.({ phase: 'Known problem turn unavailable', detail: `${KNOWN_PROBLEM_TURN_ID} was not retained by the automatic crawl. Recording that failure and continuing to the crawler-selected diagnostic target.`, scanComplete: true });
  }

  retainedTurns = await getRetainedTurns(page);
  const preferredTarget = selectTargetFromTurns(retainedTurns, { excludeIds: knownProblemTarget ? [KNOWN_PROBLEM_TURN_ID] : [] });
  if (!preferredTarget) {
    summary.preferredTargetSkipped = true;
    summary.preferredTargetSkipReason = 'No second retained target remained after excluding turn 54.';
  } else {
    const updatedRetainedTurnIds = sortTurnIds(retainedTurns.map(turn => turn.id));
    const preferredStepResult = await captureManualStep({
      page, target: preferredTarget,
      step: { index: knownProblemTarget ? 2 : 1, count: knownProblemTarget ? 2 : 1, label: 'Crawler-selected diagnostic turn', buttonLabel: 'Finish manual inspection' },
      retainedTurnIds: updatedRetainedTurnIds, diagnosticDirectory, shouldCancel, onProgress, convergeMounted,
      snapshotFilename: 'after-preferred-turn-manual-before-reconvergence.html'
    });
    summary.steps.push(preferredStepResult);
  }

  await page.evaluate(() => window.__archiveCrawler.capture());
  const finalStats = await getCrawlerStats(page);
  const postManualSnapshot = await assembleDiagnosticSnapshot(page, page.url());
  await writeSnapshot(diagnosticDirectory, 'post-manual.html', postManualSnapshot);
  summary.postManual = { crawlerStats: finalStats, snapshotStats: postManualSnapshot.stats };
  await writeSummary(diagnosticDirectory, summary);
  const totalInteractions = summary.steps.reduce((total, stepResult) => total + Number(stepResult?.manual?.interactionCount || 0), 0);
  await onProgress?.({
    phase: 'Manual inspection complete',
    detail: `Saved the automatic baseline, both manual-step snapshots, post-manual.html, and summary.json under ${path.relative(PROJECT_ROOT, diagnosticDirectory)}. Building the normal final archive next.`,
    scanningStatus: `Two-step manual inspection complete · ${totalInteractions} interaction(s) recorded`,
    scanComplete: true
  });
}
