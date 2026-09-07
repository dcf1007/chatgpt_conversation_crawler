import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMhtmlRecorder } from './mhtml-recorder.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_INTERVAL_MS = 1000;
const MATERIAL_CAPTURE_COOLDOWN_MS = 2000;
const RESOURCE_CAPTURE_COOLDOWN_MS = 3000;
const pageState = new WeakMap();
const contextState = new WeakMap();
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
 * Sample both raw live DOM state and crawler/manual-inspection diagnostics.
 * Keeping both matters: a discrepancy between raw collapsed controls and the
 * crawler's recognized controls is exactly the kind of classifier gap this
 * development build is meant to expose.
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
    const rawCollapsedControls = document.querySelectorAll(`${turnSelector} [aria-expanded="false"]`).length;
    const rawClosedDetails = document.querySelectorAll(`${turnSelector} details:not([open])`).length;

    return {
      turns: sections.length,
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
      manualPhase: String(manualState.phase || ''),
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
    sample.turns,
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
    sample.manualPhase,
    sample.manualTargetTurnId,
    sample.manualInteractionCount,
    sample.manualFinishRequested,
    sample.manualEventCount
  ].join('|');
}

function manualStateChanged(previousSample, currentSample) {
  if (!previousSample) return Boolean(currentSample.manualPhase);
  return previousSample.manualPhase !== currentSample.manualPhase ||
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
  await markPageMode(page, mode);

  const diagnosticState = {
    id: createDiagnosticId(mode),
    sessionMode: normalizeMode(mode),
    url: page.url(),
    phase: 'Browser MHTML diagnostic',
    pass: 0,
    direction: '',
    step: 0,
    turns: 0,
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
  contextState.get(page.context())?.recorders.add(state);

  const capture = async (reason, sample = null) => {
    if (state.closing) return;
    if (sample) {
      Object.assign(diagnosticState, {
        url: page.url(),
        turns: sample.turns,
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
      const now = Date.now();

      if (now - state.lastMaterialCaptureAt >= MATERIAL_CAPTURE_COOLDOWN_MS) {
        state.lastMaterialCaptureAt = now;
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

    const now = Date.now();
    if (now - state.lastResourceCaptureAt < RESOURCE_CAPTURE_COOLDOWN_MS) return;
    state.lastResourceCaptureAt = now;
    clearTimeout(state.resourceTimer);
    state.resourceTimer = setTimeout(async () => {
      if (state.closing || page.isClosed()) return;
      const currentSample = await samplePage(page).catch(() => null);
      await capture('lazy-resource-loaded', currentSample);
    }, 700);
    state.resourceTimer.unref?.();
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

function attachPage(page, mode) {
  const maybeStart = () => {
    void markPageMode(page, mode);
    void startRecorder(page, mode);
  };

  page.on('domcontentloaded', maybeStart);
  page.on('load', maybeStart);
  if (isShareUrl(page.url())) maybeStart();
}

function instrumentContext(context, mode) {
  if (contextState.has(context)) return context;

  const state = { recorders: new Set(), closing: false };
  contextState.set(context, state);
  context.on('page', page => attachPage(page, mode));
  for (const page of context.pages()) attachPage(page, mode);

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
