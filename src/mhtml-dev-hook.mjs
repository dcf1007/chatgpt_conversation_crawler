import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMhtmlRecorder } from './mhtml-recorder.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_INTERVAL_MS = 1000;
const MATERIAL_CAPTURE_COOLDOWN_MS = 2000;
const RESOURCE_CAPTURE_COOLDOWN_MS = 3000;
const pageState = new WeakMap();
const contextState = new WeakMap();
let diagnosticSequence = 0;

const isShareUrl = value => {
  try {
    const url = new URL(String(value || ''));
    return ['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase()) && url.pathname.startsWith('/share/');
  } catch {
    return false;
  }
};

const safeMode = mode => mode === 'authenticated' ? 'authenticated' : 'anonymous';

function diagnosticId(mode) {
  diagnosticSequence++;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `dev-${stamp}-${safeMode(mode)}-${String(diagnosticSequence).padStart(3, '0')}`;
}

async function samplePage(page) {
  return page.evaluate(() => {
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const sections = [...document.querySelectorAll(turnSelector)];
    const ids = sections.map(section => section.getAttribute('data-testid')).filter(Boolean);
    const scrollRoot = document.querySelector('#thread') || document.querySelector('main#main') || document.querySelector('main') || document.scrollingElement || document.documentElement;
    return {
      turns: sections.length,
      mountedFirst: ids[0] || 'none',
      mountedLast: ids[ids.length - 1] || 'none',
      scrollHeight: Number(scrollRoot?.scrollHeight || document.documentElement?.scrollHeight || 0),
      textLength: (document.body?.innerText || document.body?.textContent || '').length,
      preBlocks: document.querySelectorAll(`${turnSelector} pre`).length,
      codeBlocks: document.querySelectorAll(`${turnSelector} code`).length,
      images: document.querySelectorAll(`${turnSelector} img`).length,
      svgs: document.querySelectorAll(`${turnSelector} svg`).length,
      iframes: document.querySelectorAll('iframe').length,
      appBlocks: document.querySelectorAll('[data-app-block-preview="true"]').length,
      collapsed: document.querySelectorAll(`${turnSelector} [aria-expanded="false"],${turnSelector} details:not([open])`).length,
      expanded: document.querySelectorAll(`${turnSelector} [aria-expanded="true"],${turnSelector} details[open]`).length
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
    sample.expanded
  ].join('|');
}

async function startRecorder(page, mode) {
  if (pageState.has(page) || !isShareUrl(page.url())) return;

  const diagnostic = {
    id: diagnosticId(mode),
    sessionMode: safeMode(mode),
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

  const recorder = await createMhtmlRecorder(root, diagnostic, page).catch(() => null);
  if (!recorder) return;

  const state = {
    recorder,
    diagnostic,
    sampleTimer: null,
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
      Object.assign(diagnostic, {
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
  const initial = await samplePage(page).catch(() => null);
  if (initial) {
    state.lastSignature = sampleSignature(initial);
    state.lastMaterialCaptureAt = Date.now();
  }
  await capture('initial-loaded', initial);
  recorder.startPeriodic();

  state.sampleTimer = setInterval(async () => {
    if (state.closing || page.isClosed() || !isShareUrl(page.url())) return;
    const sample = await samplePage(page).catch(() => null);
    if (!sample) return;
    const signature = sampleSignature(sample);
    if (signature !== state.lastSignature) {
      state.lastSignature = signature;
      const now = Date.now();
      if (now - state.lastMaterialCaptureAt >= MATERIAL_CAPTURE_COOLDOWN_MS) {
        state.lastMaterialCaptureAt = now;
        void capture('material-dom-change', sample);
      }
    }
  }, SAMPLE_INTERVAL_MS);
  state.sampleTimer.unref?.();

  page.on('requestfinished', request => {
    if (state.closing || !isShareUrl(page.url())) return;
    const type = request.resourceType();
    if (!['image', 'fetch', 'xhr'].includes(type)) return;
    const url = request.url();
    if (!/(?:chatgpt\.com\/(?:backend-api|backend-anon)|oaiusercontent\.com|oaistatic\.com)/i.test(url)) return;
    const now = Date.now();
    if (now - state.lastResourceCaptureAt < RESOURCE_CAPTURE_COOLDOWN_MS) return;
    state.lastResourceCaptureAt = now;
    clearTimeout(state.resourceTimer);
    state.resourceTimer = setTimeout(async () => {
      if (state.closing || page.isClosed()) return;
      const sample = await samplePage(page).catch(() => null);
      await capture('lazy-resource-loaded', sample);
    }, 700);
    state.resourceTimer.unref?.();
  });
}

async function stopRecorder(state, reason = 'context-closing') {
  if (!state || state.closing) return;
  state.closing = true;
  if (state.sampleTimer) clearInterval(state.sampleTimer);
  if (state.resourceTimer) clearTimeout(state.resourceTimer);
  const page = [...pageState.entries?.() || []];
  try {
    await state.recorder.capture(reason).catch(() => {});
  } finally {
    await state.recorder.close().catch(() => {});
  }
}

function attachPage(page, mode) {
  const maybeStart = () => { void startRecorder(page, mode); };
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
      for (const recorderState of [...state.recorders]) await stopRecorder(recorderState, 'context-closing');
    }
    return originalClose(...args);
  };
  return context;
}

function patchBrowser(browser) {
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => instrumentContext(await originalNewContext(...args), 'anonymous');
  return browser;
}

const originalLaunch = chromium.launch.bind(chromium);
const originalLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium);

chromium.launch = async (...args) => patchBrowser(await originalLaunch(...args));
chromium.launchPersistentContext = async (...args) => instrumentContext(await originalLaunchPersistentContext(...args), 'authenticated');
