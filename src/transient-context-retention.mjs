import { captureMountedAppBlocks } from './app-blocks.mjs';
import { captureMountedMainImages } from './main-images.mjs';

const STORE = Symbol.for('chatgpt-conversation-crawler.transient-context-retention');
const BINDING = '__archiveTransientContextCapture';
const APP_TRAILING_CAPTURE_MS = 1650;

function stateFor(page) {
  if (!page[STORE]) {
    page[STORE] = {
      installed: false,
      sealed: false,
      running: null,
      requestedKinds: new Set(),
      captures: 0,
      appTrailingTimer: null,
      lastAppEventAt: 0
    };
  }
  return page[STORE];
}

async function drain(page) {
  const state = stateFor(page);
  if (state.sealed && !state.requestedKinds.size) return;
  if (state.running) return state.running;
  state.running = (async () => {
    while (state.requestedKinds.size) {
      const kinds = new Set(state.requestedKinds);
      state.requestedKinds.clear();
      if (kinds.has('app')) await captureMountedAppBlocks(page).catch(() => {});
      if (kinds.has('image')) await captureMountedMainImages(page).catch(() => {});
      state.captures++;
    }
  })().finally(() => { state.running = null; });
  return state.running;
}

function cancelTrailingAppCapture(state) {
  if (!state.appTrailingTimer) return;
  clearTimeout(state.appTrailingTimer);
  state.appTrailingTimer = null;
}

function scheduleTrailingAppCapture(page) {
  const state = stateFor(page);
  if (state.sealed) return;
  state.lastAppEventAt = Date.now();
  cancelTrailingAppCapture(state);
  state.appTrailingTimer = setTimeout(() => {
    state.appTrailingTimer = null;
    if (state.sealed) return;
    state.requestedKinds.add('app');
    void drain(page);
  }, APP_TRAILING_CAPTURE_MS);
  state.appTrailingTimer.unref?.();
}

/**
 * Retain context that lives outside a conversation-turn clone or requires Node
 * access while it is still mounted: timeline/branch markers, app-preview frame
 * trees, and transient blob/image DOM.
 *
 * App mutations receive an immediate capture plus one trailing capture after the
 * app-block throttle window. Repeated mutations coalesce into one trailing pass;
 * no periodic polling is introduced.
 */
export async function installTransientContextRetention(page) {
  const state = stateFor(page);
  if (state.installed) return;

  await page.exposeBinding(BINDING, async (_source, kind) => {
    if (state.sealed) return;
    if (kind === 'app') {
      state.requestedKinds.add('app');
      scheduleTrailingAppCapture(page);
    } else if (kind === 'image') {
      state.requestedKinds.add('image');
    }
    await drain(page);
  });

  await page.evaluate(bindingName => {
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const appSelector = '[data-app-block-preview="true"]';

    const matchesOrContains = (node, selector) => {
      if (!node || typeof node.matches !== 'function') return false;
      return node.matches(selector) || Boolean(node.querySelector?.(selector));
    };

    const notify = kind => {
      try { void window[bindingName]?.(kind); } catch {}
    };

    const observer = new MutationObserver(records => {
      let timelineChanged = false;
      let appChanged = false;
      let imageChanged = false;

      for (const record of records) {
        const target = record.target;
        if (target?.closest?.(appSelector)) appChanged = true;
        if (target?.closest?.(turnSelector) && target?.closest?.('img')) imageChanged = true;
        if (target?.matches?.('[role="separator"][aria-label]') || target?.closest?.('p')?.querySelector?.('a[href*="/c/"]')) timelineChanged = true;

        for (const node of record.addedNodes || []) {
          if (matchesOrContains(node, appSelector)) appChanged = true;
          if (matchesOrContains(node, `${turnSelector} img`) || (node?.matches?.('img') && node.closest?.(turnSelector))) imageChanged = true;
          if (
            matchesOrContains(node, '[role="separator"][aria-label]')
            || matchesOrContains(node, 'p a[href*="/c/"]')
          ) timelineChanged = true;
        }

        for (const node of record.removedNodes || []) {
          if (matchesOrContains(node, appSelector)) appChanged = true;
        }
      }

      if (timelineChanged) window.__archiveCrawler?.captureTimelineMarkers?.();
      if (appChanged) notify('app');
      if (imageChanged) notify('image');
    });

    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'data-app-block-preview', 'aria-label']
    });
    window.__archiveTransientContextObserver = observer;
    if (document.querySelector(appSelector)) notify('app');
    if (document.querySelector(`${turnSelector} img`)) notify('image');
  }, BINDING);
  state.installed = true;
  await page.evaluate(() => window.__archiveCrawler?.captureTimelineMarkers?.()).catch(() => {});
}

export async function flushTransientContextRetention(page) {
  const state = stateFor(page);
  if (!state.installed || state.sealed) return { captures: state.captures, installed: state.installed, sealed: state.sealed };
  state.requestedKinds.add('app');
  state.requestedKinds.add('image');
  await drain(page);
  await page.evaluate(() => window.__archiveCrawler?.captureTimelineMarkers?.()).catch(() => {});
  return { captures: state.captures, installed: true, sealed: false };
}

/** Final beta4 passive-retention barrier. */
export async function sealTransientContextRetention(page) {
  const state = stateFor(page);
  if (!state.installed) return { captures: state.captures, installed: false, sealed: false };
  if (state.sealed) return { captures: state.captures, installed: true, sealed: true };

  const age = Date.now() - Number(state.lastAppEventAt || 0);
  const remaining = state.lastAppEventAt ? Math.max(0, APP_TRAILING_CAPTURE_MS - age) : 0;
  cancelTrailingAppCapture(state);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));

  state.requestedKinds.add('app');
  state.requestedKinds.add('image');
  await drain(page);
  await page.evaluate(() => {
    window.__archiveCrawler?.captureTimelineMarkers?.();
    window.__archiveTransientContextObserver?.disconnect?.();
    window.__archiveTransientContextObserver = null;
  }).catch(() => {});
  state.sealed = true;
  state.requestedKinds.clear();
  return { captures: state.captures, installed: true, sealed: true };
}
