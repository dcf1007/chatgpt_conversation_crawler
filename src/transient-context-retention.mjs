import { captureMountedAppBlocks } from './app-blocks.mjs';
import { captureMountedMainImages } from './main-images.mjs';

const STORE = Symbol.for('chatgpt-conversation-crawler.transient-context-retention');
const BINDING = '__archiveTransientContextCapture';

function stateFor(page) {
  if (!page[STORE]) {
    page[STORE] = {
      installed: false,
      running: null,
      requestedKinds: new Set(),
      observerInstalled: false,
      captures: 0
    };
  }
  return page[STORE];
}

async function drain(page) {
  const state = stateFor(page);
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

/**
 * Retain context that lives outside a conversation-turn clone or requires Node
 * access while it is still mounted: timeline/branch markers, app-preview frame
 * trees, and transient blob/image DOM.
 */
export async function installTransientContextRetention(page) {
  const state = stateFor(page);
  if (state.installed) return;
  state.installed = true;

  await page.exposeBinding(BINDING, async (_source, kind) => {
    if (kind === 'app' || kind === 'image') state.requestedKinds.add(kind);
    await drain(page);
  });

  await page.evaluate(bindingName => {
    if (window.__archiveTransientContextObserver) return;
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
  state.observerInstalled = true;
}

export async function flushTransientContextRetention(page) {
  const state = stateFor(page);
  state.requestedKinds.add('app');
  state.requestedKinds.add('image');
  await drain(page);
  await page.evaluate(() => window.__archiveCrawler?.captureTimelineMarkers?.()).catch(() => {});
  return { captures: state.captures };
}
