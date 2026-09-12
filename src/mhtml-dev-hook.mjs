import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMhtmlRecorder } from './mhtml-recorder.mjs';
import { createAsyncStartGate } from './mhtml-start-gate.mjs';
import { diagnosticSampleSignature } from './mhtml-manifest-metadata.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL_SAMPLE_COOLDOWN_MS = 2000;
const EVENT_SETTLE_MS = 180;
const PAGE_EVENT_DEBOUNCE_MS = 500;
const RESOURCE_CAPTURE_COOLDOWN_MS = 3000;
const DIAGNOSTIC_EVENT_BINDING = '__archiveCrawlerDiagnosticEvent';
const DIAGNOSTIC_PROGRESS_EVENT = 'archive-crawler-diagnostic-progress';

const pageState = new WeakMap();
const contextState = new WeakMap();
const runRecorderStart = createAsyncStartGate();
let diagnosticSequence = 0;

function isShareUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase()) &&
      url.pathname.startsWith('/share/');
  } catch {
    return false;
  }
}

function normalizeMode(mode) {
  return mode === 'authenticated' ? 'authenticated' : 'anonymous';
}

function createDiagnosticId(mode) {
  diagnosticSequence++;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `dev-${timestamp}-${normalizeMode(mode)}-${String(diagnosticSequence).padStart(3, '0')}`;
}

/**
 * Read page diagnostics on demand. The lightweight mode is used only after an
 * actual browser/crawler event and avoids crawler.stats(), per-turn outerHTML,
 * disclosure-key arrays, and other deep forensic work. Rich mode is collected
 * only when an MHTML is actually about to be written (or for final shutdown).
 */
async function samplePage(page, { rich = false } = {}) {
  return page.evaluate(({ rich }) => {
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const sections = [...document.querySelectorAll(turnSelector)];
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const sortTurnIds = ids => [...new Set(ids.filter(Boolean))]
      .sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
    const crawler = window.__archiveCrawler;
    const crawlerState = crawler?.state || {};
    const mountedIds = sortTurnIds(sections.map(section => section.getAttribute('data-testid')));
    const retainedTurnIds = sortTurnIds(Object.keys(crawlerState.turns || {}));
    const scrollRoot = document.querySelector('#thread') ||
      document.querySelector('main#main') ||
      document.querySelector('main') ||
      document.scrollingElement ||
      document.documentElement;
    const crawlerMetrics = crawler?.metrics?.() || {};
    const progressState = window.__archiveDiagnosticProgress || {};
    const manualState = window.__archiveManualInspection || {};

    const rawCollapsedControls = document.querySelectorAll(`${turnSelector} [aria-expanded="false"]`).length;
    const rawClosedDetails = document.querySelectorAll(`${turnSelector} details:not([open])`).length;

    // Event detection only needs scalar semantic state. Build the large maps and
    // ID/key arrays later, and only for an actual MHTML capture.
    let hydrationConflictsUnresolved = 0;
    for (const conflict of Object.values(crawlerState.hydrationConflicts || {})) {
      if (conflict?.active) hydrationConflictsUnresolved++;
    }
    let turnProcessingFailures = 0;
    for (const result of Object.values(crawlerState.turnProcessingResults || {})) {
      if (result?.converged === false) turnProcessingFailures++;
    }
    let retainedUnresolvedDisclosures = 0;
    let retainedUnresolvedTurns = 0;
    for (const id of retainedTurnIds) {
      const revision = Number(crawlerState.turnRevisions?.[id] || 0);
      let turnHasActionable = false;
      for (const logicalKey of crawlerState.disclosureKnownKeysByTurn?.[id] || []) {
        const hasCompletion = Object.prototype.hasOwnProperty.call(crawlerState.disclosureCompletions || {}, logicalKey);
        const completed = hasCompletion ? Number(crawlerState.disclosureCompletions[logicalKey] || 0) : null;
        if (completed === null || completed < revision) {
          retainedUnresolvedDisclosures++;
          turnHasActionable = true;
        }
      }
      if (turnHasActionable) retainedUnresolvedTurns++;
    }
    const reconciliation = crawlerState.reconciliation || {};
    const reconciliationConverged = reconciliation.converged === true
      ? true
      : reconciliation.converged === false
        ? false
        : null;

    const maximumTop = Math.max(0,
      Number(crawlerMetrics.height ?? scrollRoot?.scrollHeight ?? 0) -
      Number(crawlerMetrics.client ?? scrollRoot?.clientHeight ?? window.innerHeight ?? 0)
    );
    const currentTop = Number(crawlerMetrics.top ?? scrollRoot?.scrollTop ?? window.scrollY ?? 0);
    const timelineMarkers = Object.keys(crawlerState.timelineMarkers || {}).length;
    const expansionGeneration = Number(crawlerState.expansionGeneration || 0);
    const quiescence = crawlerState.quiescence || {};

    // textContent is intentionally used instead of innerText: it still detects
    // textual mutation without forcing layout on very large virtualized pages.
    const textLength = (document.body?.textContent || '').length;

    const base = {
      mountedTurns: sections.length,
      retainedTurns: retainedTurnIds.length,
      retainedRevision: Number(crawlerState.retainedRevision || 0),
      semanticRetainedRevision: Number(crawlerState.retainedRevision || 0),
      timelineMarkers,
      oldestRetained: retainedTurnIds[0] || 'none',
      newestRetained: retainedTurnIds[retainedTurnIds.length - 1] || 'none',
      phase: String(progressState.phase || ''),
      pass: Number(progressState.pass || 0),
      direction: String(progressState.direction || ''),
      step: Number(progressState.step || 0),
      stage: String(progressState.stage || ''),
      progressDetail: String(progressState.detail || ''),
      scanningStatus: String(progressState.scanningStatus || ''),
      scanComplete: Boolean(progressState.scanComplete),
      previewPaused: Boolean(progressState.previewPaused),
      scrollTop: currentTop,
      scrollClient: Number(crawlerMetrics.client ?? scrollRoot?.clientHeight ?? window.innerHeight ?? 0),
      mountedFirst: mountedIds[0] || 'none',
      mountedLast: mountedIds[mountedIds.length - 1] || 'none',
      scrollHeight: Number(scrollRoot?.scrollHeight || document.documentElement?.scrollHeight || 0),
      physicalMaximumTop: maximumTop,
      atPhysicalTop: currentTop <= 4,
      atPhysicalBottom: currentTop >= maximumTop - 4,
      textLength,
      preBlocks: document.querySelectorAll(`${turnSelector} pre`).length,
      codeBlocks: document.querySelectorAll(`${turnSelector} code`).length,
      images: document.querySelectorAll(`${turnSelector} img`).length,
      svgs: document.querySelectorAll(`${turnSelector} svg`).length,
      iframes: document.querySelectorAll('iframe').length,
      appBlocks: document.querySelectorAll('[data-app-block-preview="true"]').length,
      collapsed: rawCollapsedControls + rawClosedDetails,
      expanded: document.querySelectorAll(`${turnSelector} [aria-expanded="true"],${turnSelector} details[open]`).length,
      expansionGeneration,
      lastExpansionTurn: String(crawlerState.lastExpansionTurn || ''),
      lastExpansionStatus: String(crawlerState.lastExpansion || ''),
      quiescentRounds: Number(quiescence.rounds || 0),
      requiredQuiescentRounds: Number(quiescence.requiredRounds || 0),
      quiescenceConverged: Boolean(quiescence.converged),
      quiescenceScopeTurn: String(quiescence.scopeTurnId || ''),
      quiescenceTimedOut: Boolean(quiescence.timedOut),
      retainedUnresolvedTurns,
      retainedUnresolvedDisclosures,
      retainedUnresolvedTurnIds: [],
      hydrationConflictsUnresolved,
      turnProcessingFailures,
      hydrationTimeoutEvents: Number(crawlerState.hydrationTimeoutEvents?.length || 0),
      scanLimitEvents: Number(crawlerState.scanLimitEvents?.length || 0),
      expansionLimitEvents: Number(crawlerState.expansionLimitEvents?.length || 0),
      reconciliationRounds: Number(reconciliation.rounds || 0),
      reconciliationStablePasses: Number(reconciliation.stablePasses || 0),
      reconciliationConverged,
      mountRetentionSealed: Boolean(crawlerState.mountRetentionSealed),
      manualPhase: String(manualState.phase || ''),
      manualStepIndex: Number(manualState.stepIndex || 0),
      manualStepCount: Number(manualState.stepCount || 0),
      manualStepLabel: String(manualState.stepLabel || ''),
      manualTargetTurnId: String(manualState.targetTurnId || ''),
      manualTargetReason: String(manualState.targetReason || ''),
      manualInteractionCount: Number(manualState.interactionCount || 0),
      manualFinishRequested: Boolean(manualState.finishRequested),
      manualEventCount: Array.isArray(manualState.events) ? manualState.events.length : 0
    };

    if (!rich) return base;

    const turnRevisionMap = Object.fromEntries(retainedTurnIds.map(id => [
      id,
      Number(crawlerState.turnRevisions?.[id] || 0)
    ]));
    const hydrationConflictTurnIdsFull = sortTurnIds(Object.entries(crawlerState.hydrationConflicts || {})
      .filter(([, conflict]) => conflict?.active)
      .map(([id]) => id));
    const turnProcessingFailureTurnIdsFull = sortTurnIds(Object.entries(crawlerState.turnProcessingResults || {})
      .filter(([, result]) => result?.converged === false)
      .map(([id]) => id));
    const hydrationTimeoutTurnIdsFull = sortTurnIds((crawlerState.hydrationTimeoutEvents || [])
      .map(event => String(event?.turnId || '')));
    const actionableLogicalKeys = [];
    const retainedUnresolvedTurnIdsFull = [];
    for (const id of retainedTurnIds) {
      const revision = Number(turnRevisionMap[id] || 0);
      let turnHasActionable = false;
      for (const logicalKey of crawlerState.disclosureKnownKeysByTurn?.[id] || []) {
        const hasCompletion = Object.prototype.hasOwnProperty.call(crawlerState.disclosureCompletions || {}, logicalKey);
        const completed = hasCompletion ? Number(crawlerState.disclosureCompletions[logicalKey] || 0) : null;
        if (completed === null || completed < revision) {
          actionableLogicalKeys.push(String(logicalKey));
          turnHasActionable = true;
        }
      }
      if (turnHasActionable) retainedUnresolvedTurnIdsFull.push(id);
    }
    actionableLogicalKeys.sort();

    const crawlerStats = (() => {
      try { return crawler?.stats?.() || {}; }
      catch { return {}; }
    })();

    // turnDisclosureSample() includes whole-turn text/html metrics. Calling it
    // for every mounted turn was the largest dev2 hot path, so only mounted
    // turns that actually contain a closed disclosure candidate are inspected.
    const candidateDisclosureIds = sortTurnIds(sections
      .filter(section => section.querySelector('[aria-expanded="false"],details:not([open])'))
      .map(section => section.getAttribute('data-testid')));
    const disclosureByTurn = [];
    for (const id of candidateDisclosureIds) {
      let disclosure = {};
      try { disclosure = crawler?.turnDisclosureSample?.(id) || {}; }
      catch {}
      if (!Number(disclosure.recognizedCollapsed || 0) && !Number(disclosure.actionableCollapsed || 0)
          && !Number(disclosure.closedDetails || 0)) continue;
      disclosureByTurn.push({
        turnId: id,
        turnRevision: Number(disclosure.turnRevision || turnRevisionMap[id] || 0),
        recognizedCollapsed: Number(disclosure.recognizedCollapsed || 0),
        actionableCollapsed: Number(disclosure.actionableCollapsed || 0),
        closedDetails: Number(disclosure.closedDetails || 0),
        recognizedLogicalKeys: Array.isArray(disclosure.recognizedLogicalKeys) ? disclosure.recognizedLogicalKeys : [],
        actionableLogicalKeys: Array.isArray(disclosure.actionableLogicalKeys) ? disclosure.actionableLogicalKeys : [],
        closedDetailLogicalKeys: Array.isArray(disclosure.closedDetailLogicalKeys) ? disclosure.closedDetailLogicalKeys : []
      });
    }

    const activeTurnId = String(
      progressState.targetTurnId ||
      manualState.targetTurnId ||
      crawlerStats.quiescenceScopeTurn ||
      crawlerState.lastExpansionTurn ||
      ''
    );
    const targetDisclosure = disclosureByTurn.find(item => item.turnId === activeTurnId) || {};

    return {
      ...base,
      retainedTurns: Number(crawlerStats.turns || retainedTurnIds.length),
      retainedRevision: Number(crawlerStats.retainedRevision || crawlerStats.semanticRetainedRevision || crawlerState.retainedRevision || 0),
      semanticRetainedRevision: Number(crawlerStats.semanticRetainedRevision || crawlerStats.retainedRevision || crawlerState.retainedRevision || 0),
      retainedCorpusFingerprint: String(crawlerStats.retainedCorpusFingerprint || crawler?.retainedCorpusFingerprint?.() || ''),
      timelineMarkers: Number(crawlerStats.timelineMarkers || timelineMarkers),
      oldestRetained: String(crawlerStats.oldestRetained || base.oldestRetained),
      newestRetained: String(crawlerStats.newestRetained || base.newestRetained),
      allCollapsedControls: Number(crawlerStats.allCollapsedControls ?? rawCollapsedControls),
      recognizedCollapsed: Number(crawlerStats.recognizedCollapsed || 0),
      actionableCollapsed: Number(crawlerStats.actionableCollapsed || 0),
      closedDetails: Number(crawlerStats.closedDetails ?? rawClosedDetails),
      retainedUnresolvedTurnIds: retainedUnresolvedTurnIdsFull.slice(0, 20),
      hydrationConflictsResolved: Number(crawlerStats.hydrationConflictsResolved || 0),
      oldestConverged: crawlerStats.oldestConverged ?? null,
      oldestQuietChecks: Number(crawlerStats.oldestQuietChecks || 0),
      oldestChecks: Number(crawlerStats.oldestChecks || 0),
      seenMountedTurns: Number(crawlerStats.seenMountedTurns || 0),
      seenMountedUnretainedTurns: Number(crawlerStats.seenMountedUnretainedTurns || 0),
      seenMountedUnretainedTurnIds: Array.isArray(crawlerStats.seenMountedUnretainedTurnIds)
        ? crawlerStats.seenMountedUnretainedTurnIds.slice(0, 20)
        : [],
      mountObserverImmediateCaptures: Number(crawlerStats.mountObserverImmediateCaptures || 0),
      mountObserverSettledCaptures: Number(crawlerStats.mountObserverSettledCaptures || 0),
      mountObserverEvents: Number(crawlerStats.mountObserverEvents || 0),
      mountObserverHydrationEvents: Number(crawlerStats.mountObserverHydrationEvents || 0),
      mountObserverFlushCaptures: Number(crawlerStats.mountObserverFlushCaptures || 0),
      activeTurnId,
      activeTurnRevision: Number(turnRevisionMap[activeTurnId] || 0),
      activeTurnRecognizedCollapsed: Number(targetDisclosure.recognizedCollapsed || 0),
      activeTurnActionableCollapsed: Number(targetDisclosure.actionableCollapsed || 0),
      activeTurnClosedDetails: Number(targetDisclosure.closedDetails || 0),

      // Rich state is compacted into hashes+deltas by the recorder and is never
      // part of the event-detection signature.
      mountedTurnIds: mountedIds,
      retainedTurnIds,
      turnRevisionMap,
      hydrationConflictTurnIdsFull,
      turnProcessingFailureTurnIdsFull,
      hydrationTimeoutTurnIdsFull,
      retainedUnresolvedTurnIdsFull,
      actionableLogicalKeys,
      disclosureByTurn
    };
  }, { rich: Boolean(rich) });
}

function manualStateChanged(previousSample, currentSample) {
  if (!previousSample) return Boolean(currentSample.manualPhase);
  return previousSample.manualPhase !== currentSample.manualPhase ||
    previousSample.manualStepIndex !== currentSample.manualStepIndex ||
    previousSample.manualStepCount !== currentSample.manualStepCount ||
    previousSample.manualStepLabel !== currentSample.manualStepLabel ||
    previousSample.manualTargetTurnId !== currentSample.manualTargetTurnId ||
    previousSample.manualInteractionCount !== currentSample.manualInteractionCount ||
    previousSample.manualFinishRequested !== currentSample.manualFinishRequested ||
    previousSample.manualEventCount !== currentSample.manualEventCount;
}

async function markPageMode(page, mode) {
  await page.evaluate(sessionMode => {
    window.__archiveCrawlerDevSessionMode = sessionMode;
  }, normalizeMode(mode)).catch(() => {});
}

async function installPageEventBridge(page) {
  await page.evaluate(({ bindingName, progressEvent, debounceMs }) => {
    window.__archiveMhtmlDiagnosticBridge?.dispose?.();

    const pendingReasons = new Set();
    let timer = null;
    const emit = () => {
      timer = null;
      const reasons = [...pendingReasons];
      pendingReasons.clear();
      const binding = window[bindingName];
      if (typeof binding !== 'function') return;
      void Promise.resolve(binding(reasons.join(',') || 'page-event')).catch(() => {});
    };
    const queue = reason => {
      pendingReasons.add(String(reason || 'page-event'));
      if (timer) return;
      timer = setTimeout(emit, debounceMs);
    };

    const root = document.querySelector('#thread') || document.querySelector('main') || document.documentElement;
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList' || record.type === 'characterData' || record.type === 'attributes') {
          queue('dom-mutation');
          break;
        }
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'open', 'href', 'src', 'data-testid', 'data-message-author-role']
    });

    const onProgress = () => queue('crawler-progress');
    const onVisibility = () => queue('visibility-change');
    const onFocus = () => queue('focus-change');
    window.addEventListener(progressEvent, onProgress);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onFocus);

    window.__archiveMhtmlDiagnosticBridge = {
      observer,
      dispose() {
        observer.disconnect();
        if (timer) clearTimeout(timer);
        timer = null;
        pendingReasons.clear();
        window.removeEventListener(progressEvent, onProgress);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onFocus);
      }
    };
  }, {
    bindingName: DIAGNOSTIC_EVENT_BINDING,
    progressEvent: DIAGNOSTIC_PROGRESS_EVENT,
    debounceMs: PAGE_EVENT_DEBOUNCE_MS
  }).catch(() => {});
}

async function disposePageEventBridge(page) {
  if (!page || page.isClosed()) return;
  await page.evaluate(() => {
    window.__archiveMhtmlDiagnosticBridge?.dispose?.();
    delete window.__archiveMhtmlDiagnosticBridge;
  }).catch(() => {});
}

async function startRecorder(page, mode) {
  if (pageState.has(page) || !isShareUrl(page.url())) return;

  return runRecorderStart(page, async () => {
    if (pageState.has(page) || !isShareUrl(page.url())) return;

    const owningContext = contextState.get(page.context());
    if (owningContext?.targetPage && owningContext.targetPage !== page) return;

    await markPageMode(page, mode);

    const diagnosticState = {
      id: createDiagnosticId(mode),
      sessionMode: normalizeMode(mode),
      url: page.url(),
      phase: 'Browser MHTML diagnostic',
      pass: 0,
      direction: '',
      step: 0,
      mountedTurns: 0,
      retainedTurns: 0,
      oldestRetained: 'none',
      newestRetained: 'none',
      mountedFirst: 'none',
      mountedLast: 'none',
      scrollHeight: 0,
      preBlocks: 0,
      codeBlocks: 0,
      appBlocks: 0
    };

    const recorder = await createMhtmlRecorder(PROJECT_ROOT, diagnosticState, page).catch(() => null);
    if (!recorder) return;

    const state = {
      page,
      recorder,
      diagnosticState,
      previousSample: null,
      lastSignature: '',
      lastEventSampleAt: 0,
      lastResourceCaptureAt: 0,
      eventTimer: null,
      resourceTimer: null,
      pendingEventReasons: new Set(),
      closing: false
    };
    pageState.set(page, state);
    if (owningContext) {
      owningContext.recorderState = state;
      owningContext.recorders.add(state);
    }

    const capture = async (reason, sample = null) => {
      if (state.closing) return;
      if (sample) {
        Object.assign(diagnosticState, {
          url: page.url(),
          phase: sample.phase || diagnosticState.phase,
          pass: sample.pass,
          direction: sample.direction,
          step: sample.step,
          stage: sample.stage,
          mountedTurns: sample.mountedTurns,
          retainedTurns: sample.retainedTurns,
          oldestRetained: sample.oldestRetained,
          newestRetained: sample.newestRetained,
          scrollTop: sample.scrollTop,
          scrollClient: sample.scrollClient,
          mountedFirst: sample.mountedFirst,
          mountedLast: sample.mountedLast,
          scrollHeight: sample.scrollHeight,
          preBlocks: sample.preBlocks,
          codeBlocks: sample.codeBlocks,
          appBlocks: sample.appBlocks
        });
      }
      await recorder.capture(reason, sample ? { __diagnosticSample: sample } : {}).catch(() => {});
    };

    const updateObservedSample = sample => {
      if (!sample) return;
      state.previousSample = sample;
      state.lastSignature = diagnosticSampleSignature(sample);
    };

    const captureRich = async reason => {
      if (state.closing || page.isClosed()) return;
      const richSample = await samplePage(page, { rich: true }).catch(() => null);
      if (richSample) updateObservedSample(richSample);
      await capture(reason, richSample);
    };

    const sampleMaterialEvent = async () => {
      state.eventTimer = null;
      if (state.closing || page.isClosed() || !isShareUrl(page.url())) return;
      state.lastEventSampleAt = Date.now();
      const currentSample = await samplePage(page, { rich: false }).catch(() => null);
      if (!currentSample) return;

      const previousSample = state.previousSample;
      const signature = diagnosticSampleSignature(currentSample);
      state.previousSample = currentSample;
      state.lastSignature = signature;
      state.pendingEventReasons.clear();
      if (signature === state.lastCapturedSignature) return;

      const reason = manualStateChanged(previousSample, currentSample)
        ? 'manual-inspection-change'
        : 'material-dom-change';
      const richSample = await samplePage(page, { rich: true }).catch(() => currentSample);
      state.lastCapturedSignature = diagnosticSampleSignature(richSample);
      updateObservedSample(richSample);
      await capture(reason, richSample);
    };

    const signalMaterialEvent = reason => {
      if (state.closing) return;
      recorder.noteActivity();
      state.pendingEventReasons.add(String(reason || 'page-event'));
      if (state.eventTimer) return;
      const now = Date.now();
      const delay = Math.max(
        EVENT_SETTLE_MS,
        MATERIAL_SAMPLE_COOLDOWN_MS - Math.max(0, now - state.lastEventSampleAt)
      );
      state.eventTimer = setTimeout(() => {
        void sampleMaterialEvent();
      }, delay);
      state.eventTimer.unref?.();
    };

    state.lastCapturedSignature = '';

    await page.exposeBinding(DIAGNOSTIC_EVENT_BINDING, async (_source, reason) => {
      const current = pageState.get(page);
      if (!current || current.closing) return;
      signalMaterialEvent(reason);
    }).catch(() => {});
    await installPageEventBridge(page);

    await page.waitForTimeout(300).catch(() => {});
    const initialSample = await samplePage(page, { rich: true }).catch(() => null);
    if (initialSample) {
      updateObservedSample(initialSample);
      state.lastCapturedSignature = state.lastSignature;
      state.lastEventSampleAt = Date.now();
    }
    await capture('initial-loaded', initialSample);

    recorder.startPeriodic(async () => {
      if (state.closing || page.isClosed() || !isShareUrl(page.url())) return;
      await captureRich('periodic-10s');
    });

    page.on('requestfinished', request => {
      if (state.closing || !isShareUrl(page.url())) return;
      const resourceType = request.resourceType();
      if (!['image', 'fetch', 'xhr'].includes(resourceType)) return;

      const resourceUrl = request.url();
      if (!/(?:chatgpt\.com\/(?:backend-api|backend-anon)|oaiusercontent\.com|oaistatic\.com)/i.test(resourceUrl)) return;

      recorder.noteActivity();
      const currentTime = Date.now();
      if (currentTime - state.lastResourceCaptureAt < RESOURCE_CAPTURE_COOLDOWN_MS) return;
      state.lastResourceCaptureAt = currentTime;
      clearTimeout(state.resourceTimer);
      state.resourceTimer = setTimeout(async () => {
        if (state.closing || page.isClosed()) return;
        await captureRich('lazy-resource-loaded');
      }, 700);
      state.resourceTimer.unref?.();
    });
  });
}

async function stopRecorder(state, reason = 'context-closing') {
  if (!state || state.closing) return;
  if (state.eventTimer) clearTimeout(state.eventTimer);
  if (state.resourceTimer) clearTimeout(state.resourceTimer);
  await disposePageEventBridge(state.page);

  try {
    const finalSample = state.page && !state.page.isClosed()
      ? await samplePage(state.page, { rich: true }).catch(() => state.previousSample)
      : state.previousSample;
    if (finalSample) {
      Object.assign(state.diagnosticState, {
        url: state.page?.url?.() || state.diagnosticState.url,
        phase: finalSample.phase || state.diagnosticState.phase,
        pass: finalSample.pass,
        direction: finalSample.direction,
        step: finalSample.step,
        stage: finalSample.stage,
        mountedTurns: finalSample.mountedTurns,
        retainedTurns: finalSample.retainedTurns,
        oldestRetained: finalSample.oldestRetained,
        newestRetained: finalSample.newestRetained,
        scrollTop: finalSample.scrollTop,
        scrollClient: finalSample.scrollClient,
        mountedFirst: finalSample.mountedFirst,
        mountedLast: finalSample.mountedLast,
        scrollHeight: finalSample.scrollHeight,
        preBlocks: finalSample.preBlocks,
        codeBlocks: finalSample.codeBlocks,
        appBlocks: finalSample.appBlocks
      });
    }
    await state.recorder.capture(reason, finalSample ? { __diagnosticSample: finalSample } : {}).catch(() => {});
  } finally {
    state.closing = true;
    await state.recorder.close().catch(() => {});
  }
}

function attachTargetPage(page, mode) {
  const maybeStart = () => {
    void markPageMode(page, mode);
    void startRecorder(page, mode);
  };

  page.on('domcontentloaded', maybeStart);
  page.on('load', maybeStart);

  // Do not immediately start on an already-open restored tab. The archive
  // server will navigate its chosen page to the requested /share/ URL, and
  // that navigation event becomes the authoritative recorder start.
}

function instrumentContext(context, mode) {
  if (contextState.has(context)) return context;

  const existingPages = context.pages();
  const state = {
    recorders: new Set(),
    recorderState: null,
    closing: false,
    targetPage: existingPages[0] || null
  };
  contextState.set(context, state);

  if (state.targetPage) attachTargetPage(state.targetPage, mode);

  context.on('page', page => {
    // server.mjs uses the first page in the context. Restrict diagnostics to
    // that same page so restored/stale ChatGPT tabs cannot create extra MHTML
    // folders for one archive job.
    if (!state.targetPage) {
      state.targetPage = page;
      attachTargetPage(page, mode);
    }
  });

  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    if (!state.closing) {
      state.closing = true;
      for (const recorderState of [...state.recorders]) {
        await stopRecorder(recorderState, 'context-closing');
      }
    }
    return originalClose(...args);
  };

  return context;
}

function instrumentBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => instrumentContext(await originalNewContext(...args), 'anonymous');
  return browser;
}

const originalLaunch = chromium.launch.bind(chromium);
const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium);

chromium.launch = async (...args) => instrumentBrowser(await originalLaunch(...args));
chromium.launchPersistentContext = async (...args) =>
  instrumentContext(await originalLaunchPersistentContext(...args), 'authenticated');