import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMhtmlRecorder } from './mhtml-recorder.mjs';
import { createAsyncStartGate } from './mhtml-start-gate.mjs';
import { diagnosticSampleSignature } from './mhtml-manifest-metadata.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_INTERVAL_MS = 1000;
const MATERIAL_CAPTURE_COOLDOWN_MS = 2000;
const RESOURCE_CAPTURE_COOLDOWN_MS = 3000;

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
 * Sample raw browser state alongside crawler and manual-inspection diagnostics.
 * The recorder compacts the large arrays/maps into hashes+deltas when it writes
 * an actual manifest row, so one-second sampling can remain forensic without
 * making manifest.jsonl itself another archive of the entire page state.
 */
async function samplePage(page) {
  return page.evaluate(() => {
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

    const crawlerStats = (() => {
      try { return crawler?.stats?.() || {}; }
      catch { return {}; }
    })();
    const retainedDisclosure = (() => {
      try { return crawler?.retainedDisclosureSummary?.() || {}; }
      catch { return {}; }
    })();

    const manualState = window.__archiveManualInspection || {};
    const crawlerMetrics = crawler?.metrics?.() || {};
    const progressState = window.__archiveDiagnosticProgress || {};
    const rawCollapsedControls = document.querySelectorAll(`${turnSelector} [aria-expanded="false"]`).length;
    const rawClosedDetails = document.querySelectorAll(`${turnSelector} details:not([open])`).length;
    const reconciliationConverged = crawlerStats.reconciliationConverged === true
      ? true
      : crawlerStats.reconciliationConverged === false
        ? false
        : null;

    const turnRevisionMap = Object.fromEntries(retainedTurnIds.map(id => [
      id,
      Number(crawler?.turnRevision?.(id) || crawlerState.turnRevisions?.[id] || 0)
    ]));
    const hydrationConflictTurnIdsFull = sortTurnIds(Object.entries(crawlerState.hydrationConflicts || {})
      .filter(([, conflict]) => conflict?.active)
      .map(([id]) => id));
    const turnProcessingFailureTurnIdsFull = sortTurnIds(Object.entries(crawlerState.turnProcessingResults || {})
      .filter(([, result]) => result?.converged === false)
      .map(([id]) => id));
    const hydrationTimeoutTurnIdsFull = sortTurnIds((crawlerState.hydrationTimeoutEvents || [])
      .map(event => String(event?.turnId || '')));
    const retainedUnresolvedTurnIdsFull = sortTurnIds(
      Array.isArray(retainedDisclosure.retainedUnresolvedTurnIdsFull)
        ? retainedDisclosure.retainedUnresolvedTurnIdsFull
        : crawlerStats.retainedUnresolvedTurnIds || []
    );

    const actionableLogicalKeys = [];
    for (const id of retainedTurnIds) {
      const revision = Number(turnRevisionMap[id] || 0);
      for (const logicalKey of crawlerState.disclosureKnownKeysByTurn?.[id] || []) {
        const completed = Object.prototype.hasOwnProperty.call(crawlerState.disclosureCompletions || {}, logicalKey)
          ? Number(crawlerState.disclosureCompletions[logicalKey] || 0)
          : null;
        if (completed === null || completed < revision) actionableLogicalKeys.push(String(logicalKey));
      }
    }
    actionableLogicalKeys.sort();

    const disclosureByTurn = [];
    for (const id of mountedIds) {
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

    const maximumTop = Math.max(0,
      Number(crawlerMetrics.height ?? scrollRoot?.scrollHeight ?? 0) -
      Number(crawlerMetrics.client ?? scrollRoot?.clientHeight ?? window.innerHeight ?? 0)
    );
    const currentTop = Number(crawlerMetrics.top ?? scrollRoot?.scrollTop ?? window.scrollY ?? 0);
    const activeTurnId = String(
      progressState.targetTurnId ||
      manualState.targetTurnId ||
      crawlerStats.quiescenceScopeTurn ||
      crawlerState.lastExpansionTurn ||
      ''
    );
    let targetDisclosure = {};
    if (activeTurnId) {
      try { targetDisclosure = crawler?.turnDisclosureSample?.(activeTurnId) || {}; }
      catch {}
    }

    return {
      mountedTurns: sections.length,
      retainedTurns: Number(crawlerStats.turns || 0),
      retainedRevision: Number(crawlerStats.retainedRevision || crawlerStats.semanticRetainedRevision || 0),
      semanticRetainedRevision: Number(crawlerStats.semanticRetainedRevision || crawlerStats.retainedRevision || 0),
      retainedCorpusFingerprint: String(crawlerStats.retainedCorpusFingerprint || crawler?.retainedCorpusFingerprint?.() || ''),
      timelineMarkers: Number(crawlerStats.timelineMarkers || Object.keys(crawlerState.timelineMarkers || {}).length || 0),
      oldestRetained: String(crawlerStats.oldestRetained || 'none'),
      newestRetained: String(crawlerStats.newestRetained || 'none'),
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
      textLength: (document.body?.innerText || document.body?.textContent || '').length,
      preBlocks: document.querySelectorAll(`${turnSelector} pre`).length,
      codeBlocks: document.querySelectorAll(`${turnSelector} code`).length,
      images: document.querySelectorAll(`${turnSelector} img`).length,
      svgs: document.querySelectorAll(`${turnSelector} svg`).length,
      iframes: document.querySelectorAll('iframe').length,
      appBlocks: document.querySelectorAll('[data-app-block-preview="true"]').length,
      collapsed: rawCollapsedControls + rawClosedDetails,
      expanded: document.querySelectorAll(`${turnSelector} [aria-expanded="true"],${turnSelector} details[open]`).length,
      allCollapsedControls: Number(crawlerStats.allCollapsedControls ?? rawCollapsedControls),
      recognizedCollapsed: Number(crawlerStats.recognizedCollapsed || 0),
      actionableCollapsed: Number(crawlerStats.actionableCollapsed || 0),
      closedDetails: Number(crawlerStats.closedDetails ?? rawClosedDetails),
      expansionGeneration: Number(crawlerStats.expansionGeneration || 0),
      lastExpansionTurn: String(crawlerState.lastExpansionTurn || ''),
      lastExpansionStatus: String(crawlerState.lastExpansion || ''),
      quiescentRounds: Number(crawlerStats.quiescentRounds || 0),
      requiredQuiescentRounds: Number(crawlerStats.requiredQuiescentRounds || 0),
      quiescenceConverged: Boolean(crawlerStats.quiescenceConverged),
      quiescenceScopeTurn: String(crawlerStats.quiescenceScopeTurn || ''),
      quiescenceTimedOut: Boolean(crawlerStats.quiescenceTimedOut),
      unrecognizedCollapsedLabels: Array.isArray(crawlerStats.unrecognizedCollapsedLabels)
        ? crawlerStats.unrecognizedCollapsedLabels.slice(0, 20)
        : [],
      retainedUnresolvedTurns: Number(crawlerStats.retainedUnresolvedTurns || 0),
      retainedUnresolvedDisclosures: Number(crawlerStats.retainedUnresolvedDisclosures || 0),
      retainedUnresolvedTurnIds: Array.isArray(crawlerStats.retainedUnresolvedTurnIds)
        ? crawlerStats.retainedUnresolvedTurnIds.slice(0, 20)
        : [],
      hydrationConflictsResolved: Number(crawlerStats.hydrationConflictsResolved || 0),
      hydrationConflictsUnresolved: Number(crawlerStats.hydrationConflictsUnresolved || 0),
      turnProcessingFailures: Number(crawlerStats.turnProcessingFailures || 0),
      scanLimitEvents: Number(crawlerStats.scanLimitEvents || 0),
      expansionLimitEvents: Number(crawlerStats.expansionLimitEvents || 0),
      hydrationTimeoutEvents: Number(crawlerStats.hydrationTimeoutEvents || 0),
      oldestConverged: crawlerStats.oldestConverged ?? null,
      oldestQuietChecks: Number(crawlerStats.oldestQuietChecks || 0),
      oldestChecks: Number(crawlerStats.oldestChecks || 0),
      reconciliationRounds: Number(crawlerStats.reconciliationRounds || 0),
      reconciliationStablePasses: Number(crawlerStats.reconciliationStablePasses || 0),
      reconciliationConverged,
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
      mountRetentionSealed: Boolean(crawlerStats.mountRetentionSealed),
      activeTurnId,
      activeTurnRevision: Number(turnRevisionMap[activeTurnId] || 0),
      activeTurnRecognizedCollapsed: Number(targetDisclosure.recognizedCollapsed || 0),
      activeTurnActionableCollapsed: Number(targetDisclosure.actionableCollapsed || 0),
      activeTurnClosedDetails: Number(targetDisclosure.closedDetails || 0),
      manualPhase: String(manualState.phase || ''),
      manualStepIndex: Number(manualState.stepIndex || 0),
      manualStepCount: Number(manualState.stepCount || 0),
      manualStepLabel: String(manualState.stepLabel || ''),
      manualTargetTurnId: String(manualState.targetTurnId || ''),
      manualTargetReason: String(manualState.targetReason || ''),
      manualInteractionCount: Number(manualState.interactionCount || 0),
      manualFinishRequested: Boolean(manualState.finishRequested),
      manualEventCount: Array.isArray(manualState.events) ? manualState.events.length : 0,

      // Rich state below is compacted to hashes+deltas by the recorder. It is
      // intentionally not copied wholesale into every JSONL line.
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
  });
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
      sampleTimer: null,
      previousSample: null,
      lastSignature: '',
      lastMaterialCaptureAt: 0,
      lastResourceCaptureAt: 0,
      resourceTimer: null,
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

    await page.waitForTimeout(300).catch(() => {});
    const initialSample = await samplePage(page).catch(() => null);
    if (initialSample) {
      state.previousSample = initialSample;
      state.lastSignature = diagnosticSampleSignature(initialSample);
      state.lastMaterialCaptureAt = Date.now();
    }
    await capture('initial-loaded', initialSample);
    recorder.startPeriodic();

    state.sampleTimer = setInterval(async () => {
      if (state.closing || page.isClosed() || !isShareUrl(page.url())) return;
      const currentSample = await samplePage(page).catch(() => null);
      if (!currentSample) return;

      const signature = diagnosticSampleSignature(currentSample);
      if (signature !== state.lastSignature) {
        const previousSample = state.previousSample;
        state.lastSignature = signature;
        state.previousSample = currentSample;
        const currentTime = Date.now();

        if (currentTime - state.lastMaterialCaptureAt >= MATERIAL_CAPTURE_COOLDOWN_MS) {
          state.lastMaterialCaptureAt = currentTime;
          const reason = manualStateChanged(previousSample, currentSample)
            ? 'manual-inspection-change'
            : 'material-dom-change';
          void capture(reason, currentSample);
        }
      } else {
        state.previousSample = currentSample;
      }
    }, SAMPLE_INTERVAL_MS);
    state.sampleTimer.unref?.();

    page.on('requestfinished', request => {
      if (state.closing || !isShareUrl(page.url())) return;
      const resourceType = request.resourceType();
      if (!['image', 'fetch', 'xhr'].includes(resourceType)) return;

      const resourceUrl = request.url();
      if (!/(?:chatgpt\.com\/(?:backend-api|backend-anon)|oaiusercontent\.com|oaistatic\.com)/i.test(resourceUrl)) return;

      const currentTime = Date.now();
      if (currentTime - state.lastResourceCaptureAt < RESOURCE_CAPTURE_COOLDOWN_MS) return;
      state.lastResourceCaptureAt = currentTime;
      clearTimeout(state.resourceTimer);
      state.resourceTimer = setTimeout(async () => {
        if (state.closing || page.isClosed()) return;
        const currentSample = await samplePage(page).catch(() => null);
        await capture('lazy-resource-loaded', currentSample);
      }, 700);
      state.resourceTimer.unref?.();
    });
  });
}

async function stopRecorder(state, reason = 'context-closing') {
  if (!state || state.closing) return;
  if (state.sampleTimer) clearInterval(state.sampleTimer);
  if (state.resourceTimer) clearTimeout(state.resourceTimer);

  try {
    const finalSample = state.page && !state.page.isClosed()
      ? await samplePage(state.page).catch(() => state.previousSample)
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
