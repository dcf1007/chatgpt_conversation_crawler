import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMhtmlRecorder } from './mhtml-recorder.mjs';
import { createAsyncStartGate } from './mhtml-start-gate.mjs';

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
 * Raw collapsed controls are intentionally kept separate from the crawler's
 * recognized controls so a classifier miss is visible in the manifest.
 */
async function samplePage(page) {
  return page.evaluate(() => {
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const sections = [...document.querySelectorAll(turnSelector)];
    const mountedIds = sections.map(section => section.getAttribute('data-testid')).filter(Boolean);
    const scrollRoot = document.querySelector('#thread') ||
      document.querySelector('main#main') ||
      document.querySelector('main') ||
      document.scrollingElement ||
      document.documentElement;

    const crawlerStats = (() => {
      try {
        return window.__archiveCrawler?.stats?.() || {};
      } catch {
        return {};
      }
    })();

    const manualState = window.__archiveManualInspection || {};
    const crawlerMetrics = window.__archiveCrawler?.metrics?.() || {};
    const progressState = window.__archiveDiagnosticProgress || {};
    const rawCollapsedControls = document.querySelectorAll(`${turnSelector} [aria-expanded="false"]`).length;
    const rawClosedDetails = document.querySelectorAll(`${turnSelector} details:not([open])`).length;
    const reconciliationConverged = crawlerStats.reconciliationConverged === true
      ? true
      : crawlerStats.reconciliationConverged === false
        ? false
        : null;

    return {
      mountedTurns: sections.length,
      retainedTurns: Number(crawlerStats.turns || 0),
      oldestRetained: String(crawlerStats.oldestRetained || 'none'),
      newestRetained: String(crawlerStats.newestRetained || 'none'),
      phase: String(progressState.phase || ''),
      pass: Number(progressState.pass || 0),
      direction: String(progressState.direction || ''),
      step: Number(progressState.step || 0),
      stage: String(progressState.stage || ''),
      scrollTop: Number(crawlerMetrics.top ?? scrollRoot?.scrollTop ?? window.scrollY ?? 0),
      scrollClient: Number(crawlerMetrics.client ?? scrollRoot?.clientHeight ?? window.innerHeight ?? 0),
      mountedFirst: mountedIds[0] || 'none',
      mountedLast: mountedIds[mountedIds.length - 1] || 'none',
      scrollHeight: Number(scrollRoot?.scrollHeight || document.documentElement?.scrollHeight || 0),
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
      quiescentRounds: Number(crawlerStats.quiescentRounds || 0),
      requiredQuiescentRounds: Number(crawlerStats.requiredQuiescentRounds || 0),
      quiescenceConverged: Boolean(crawlerStats.quiescenceConverged),
      unrecognizedCollapsedLabels: Array.isArray(crawlerStats.unrecognizedCollapsedLabels)
        ? crawlerStats.unrecognizedCollapsedLabels.slice(0, 12)
        : [],
      retainedUnresolvedTurns: Number(crawlerStats.retainedUnresolvedTurns || 0),
      retainedUnresolvedDisclosures: Number(crawlerStats.retainedUnresolvedDisclosures || 0),
      retainedUnresolvedTurnIds: Array.isArray(crawlerStats.retainedUnresolvedTurnIds)
        ? crawlerStats.retainedUnresolvedTurnIds.slice(0, 12)
        : [],
      reconciliationRounds: Number(crawlerStats.reconciliationRounds || 0),
      reconciliationStablePasses: Number(crawlerStats.reconciliationStablePasses || 0),
      reconciliationConverged,
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
  });
}

function sampleSignature(sample) {
  return [
    sample.mountedTurns,
    sample.retainedTurns,
    sample.oldestRetained,
    sample.newestRetained,
    sample.phase,
    sample.pass,
    sample.direction,
    sample.step,
    sample.stage,
    Math.round(sample.scrollTop),
    Math.round(sample.scrollClient),
    sample.mountedFirst,
    sample.mountedLast,
    sample.scrollHeight,
    sample.textLength,
    sample.preBlocks,
    sample.codeBlocks,
    sample.images,
    sample.svgs,
    sample.iframes,
    sample.appBlocks,
    sample.collapsed,
    sample.expanded,
    sample.allCollapsedControls,
    sample.recognizedCollapsed,
    sample.actionableCollapsed,
    sample.closedDetails,
    sample.expansionGeneration,
    sample.quiescentRounds,
    sample.retainedUnresolvedTurns,
    sample.retainedUnresolvedDisclosures,
    sample.retainedUnresolvedTurnIds.join(','),
    sample.reconciliationRounds,
    sample.reconciliationStablePasses,
    String(sample.reconciliationConverged),
    sample.manualPhase,
    sample.manualStepIndex,
    sample.manualStepCount,
    sample.manualStepLabel,
    sample.manualTargetTurnId,
    sample.manualInteractionCount,
    sample.manualFinishRequested,
    sample.manualEventCount
  ].join('|');
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
    // DOMContentLoaded and load can fire close together. Check again after the
    // asynchronous start gate is acquired so only one recorder can win.
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
      await recorder.capture(reason, sample || {}).catch(() => {});
    };

    await page.waitForTimeout(300).catch(() => {});
    const initialSample = await samplePage(page).catch(() => null);
    if (initialSample) {
      state.previousSample = initialSample;
      state.lastSignature = sampleSignature(initialSample);
      state.lastMaterialCaptureAt = Date.now();
    }
    await capture('initial-loaded', initialSample);
    recorder.startPeriodic();

    state.sampleTimer = setInterval(async () => {
      if (state.closing || page.isClosed() || !isShareUrl(page.url())) return;
      const currentSample = await samplePage(page).catch(() => null);
      if (!currentSample) return;

      const signature = sampleSignature(currentSample);
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
    await state.recorder.capture(reason).catch(() => {});
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
