const DEFAULT_SETTLE_MS = 120;
const MAX_REPORTED_MISSING_TURNS = 20;

/**
 * Install a lightweight page-side retention observer for ChatGPT's virtualized
 * conversation turns.
 *
 * beta8 intentionally stopped waiting for the whole mounted viewport to become
 * stable. That removed the pathological virtualizer/quiescence stalls, but the
 * faster traversal exposed a different race: a short turn can mount between two
 * formal scroll checkpoints and disappear again before crawler.capture() runs.
 *
 * This observer closes that race at its real authority boundary. When ChatGPT
 * mounts a conversation-turn section, the turn is recorded as seen and, if it
 * has never been retained, captured immediately. A short deferred capture then
 * gives newly inserted content one small settling window; richness-aware
 * captureTurn() makes repeated/remounted observations safe because only richer
 * retained candidates replace the previous copy.
 */
export async function installMountRetention(page, { settleMs = DEFAULT_SETTLE_MS } = {}) {
  await page.evaluate(({ settleMs, maxReportedMissingTurns }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__mountRetentionInstalled) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const pending = new Map();
    const state = crawler.state.mountRetention = {
      seenTurnIds: Object.create(null),
      immediateCaptures: 0,
      settledCaptures: 0,
      observedMountEvents: 0,
      flushCaptures: 0
    };

    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const sortedIds = ids => [...ids].sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));

    function isElementLike(node) {
      return Boolean(node && typeof node.getAttribute === 'function' && typeof node.querySelectorAll === 'function');
    }

    function sectionId(section) {
      if (!isElementLike(section)) return '';
      const id = section.getAttribute('data-testid') || '';
      return /^conversation-turn-\d+$/.test(id) ? id : '';
    }

    function currentSection(turnId) {
      return [...document.querySelectorAll(turnSelector)]
        .find(section => section.getAttribute('data-testid') === turnId) || null;
    }

    function scheduleSettledCapture(turnId) {
      const previousTimer = pending.get(turnId);
      if (previousTimer) clearTimeout(previousTimer);

      const timer = setTimeout(() => {
        pending.delete(turnId);
        if (!currentSection(turnId)) return;
        crawler.captureTurn(turnId);
        state.settledCaptures++;
      }, Math.max(0, Number(settleMs) || 0));
      pending.set(turnId, timer);
    }

    function observeSection(section) {
      const id = sectionId(section);
      if (!id) return;

      state.seenTurnIds[id] = true;
      state.observedMountEvents++;

      // The completeness bug in beta8 was specifically a never-retained short
      // turn. Capture that first observation synchronously so even a very brief
      // mount cannot slip entirely between traversal checkpoints.
      if (!crawler.state.turns[id]) {
        crawler.captureTurn(id);
        state.immediateCaptures++;
      }

      // Assistant/tool turns can continue hydrating immediately after their
      // section is inserted. One deferred richness-aware retry catches that
      // normal construction phase without reinstating viewport-wide waiting.
      scheduleSettledCapture(id);
    }

    function observeAddedNode(node) {
      if (!isElementLike(node)) return;
      if (node.matches?.(turnSelector)) observeSection(node);
      for (const section of node.querySelectorAll?.(turnSelector) || []) observeSection(section);
    }

    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(records => {
          for (const record of records) {
            if (record.type === 'attributes') {
              if (record.target?.matches?.(turnSelector)) observeSection(record.target);
              continue;
            }
            for (const node of record.addedNodes || []) observeAddedNode(node);
          }
        })
      : null;

    observer?.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-testid']
    });

    // Seed the seen set after crawler-base's initial capture. These sections
    // predate the observer and therefore will not produce insertion records.
    for (const section of document.querySelectorAll(turnSelector)) {
      const id = sectionId(section);
      if (id) state.seenTurnIds[id] = true;
    }

    function summary() {
      const seen = sortedIds(Object.keys(state.seenTurnIds));
      const missing = seen.filter(id => !crawler.state.turns[id]);
      return {
        seenMountedTurns: seen.length,
        seenMountedUnretainedTurns: missing.length,
        seenMountedUnretainedTurnIds: missing.slice(0, maxReportedMissingTurns),
        mountObserverImmediateCaptures: state.immediateCaptures,
        mountObserverSettledCaptures: state.settledCaptures,
        mountObserverEvents: state.observedMountEvents,
        mountObserverFlushCaptures: state.flushCaptures
      };
    }

    crawler.mountRetentionSummary = summary;
    crawler.flushMountRetention = async () => {
      // Give already-scheduled settled captures their tiny construction window,
      // then explicitly retain everything still mounted before finalization.
      // Do not route this final sweep through observeSection(), because doing so
      // would create a fresh set of deferred timers after the flush had returned.
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(settleMs) || 0) + 20));
      for (const section of document.querySelectorAll(turnSelector)) {
        const id = sectionId(section);
        if (id) state.seenTurnIds[id] = true;
      }
      crawler.capture();
      state.flushCaptures++;
      return summary();
    };

    const baseStats = crawler.stats.bind(crawler);
    crawler.stats = () => ({ ...baseStats(), ...summary() });
    crawler.__mountRetentionObserver = observer;
    crawler.__mountRetentionInstalled = true;
  }, { settleMs, maxReportedMissingTurns: MAX_REPORTED_MISSING_TURNS });
}

export const __testing = { DEFAULT_SETTLE_MS, MAX_REPORTED_MISSING_TURNS };
