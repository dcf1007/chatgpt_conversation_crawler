const DEFAULT_SETTLE_MS = 120;
const MAX_REPORTED_MISSING_TURNS = 20;
const SEMANTIC_ATTRIBUTE_FILTER = [
  'data-testid',
  'data-message-id',
  'data-message-author-role',
  'href',
  'src',
  'srcset',
  'alt',
  'title',
  'aria-label',
  'aria-expanded',
  'aria-controls',
  'data-math-source',
  'data-app-block-preview'
];

/**
 * Retain every observed virtualized turn generation at the turn boundary.
 *
 * Mutation records retain the concrete observed section node, not merely its
 * id, so a turn that mounts and is detached before the observer callback can
 * still be archived. Existing mounted turns are captured synchronously when
 * retention starts, and targeted semantic attributes are observed in addition
 * to child/text hydration.
 */
export async function installMountRetention(page, { settleMs = DEFAULT_SETTLE_MS } = {}) {
  await page.evaluate(({ settleMs, maxReportedMissingTurns, semanticAttributeFilter }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__mountRetentionInstalled) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const pending = new Map();
    const state = crawler.state.mountRetention = {
      seenTurnIds: Object.create(null),
      immediateCaptures: 0,
      settledCaptures: 0,
      observedMountEvents: 0,
      observedHydrationEvents: 0,
      flushCaptures: 0,
      sealed: false
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
      if (state.sealed) return;
      const previousTimer = pending.get(turnId);
      if (previousTimer) clearTimeout(previousTimer);
      const timer = setTimeout(() => {
        pending.delete(turnId);
        if (state.sealed || !currentSection(turnId)) return;
        crawler.captureTurn(turnId);
        state.settledCaptures++;
      }, Math.max(0, Number(settleMs) || 0));
      pending.set(turnId, timer);
    }

    function captureObservedTurn(section, kind) {
      const id = sectionId(section);
      if (!id) return;
      state.seenTurnIds[id] = true;
      if (kind === 'mount') state.observedMountEvents++;
      else state.observedHydrationEvents++;
      if (typeof crawler.captureSectionNode === 'function') crawler.captureSectionNode(section);
      else crawler.captureTurn(id);
      state.immediateCaptures++;
      scheduleSettledCapture(id);
    }

    function collectTurnSections(node, output) {
      if (!isElementLike(node)) return;
      if (node.matches?.(turnSelector)) output.add(node);
      for (const section of node.querySelectorAll?.(turnSelector) || []) output.add(section);
    }

    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(records => {
          if (state.sealed) return;
          const mounted = new Set();
          const hydrated = new Set();
          for (const record of records) {
            if (record.type === 'attributes') {
              if (record.target?.matches?.(turnSelector) && record.attributeName === 'data-testid') {
                mounted.add(record.target);
              } else {
                const owner = record.target?.closest?.(turnSelector)
                  || record.target?.parentElement?.closest?.(turnSelector);
                if (owner) hydrated.add(owner);
              }
              continue;
            }

            const owner = record.target?.closest?.(turnSelector)
              || record.target?.parentElement?.closest?.(turnSelector);
            if (owner) hydrated.add(owner);
            for (const node of record.addedNodes || []) collectTurnSections(node, mounted);
          }

          for (const section of mounted) {
            hydrated.delete(section);
            captureObservedTurn(section, 'mount');
          }
          for (const section of hydrated) captureObservedTurn(section, 'hydrate');
        })
      : null;

    observer?.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: semanticAttributeFilter,
      characterData: true
    });

    // There must be no installation gap: every already-mounted turn becomes a
    // retained candidate immediately rather than only being marked as "seen".
    for (const section of document.querySelectorAll(turnSelector)) captureObservedTurn(section, 'mount');

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
        mountObserverHydrationEvents: state.observedHydrationEvents,
        mountObserverFlushCaptures: state.flushCaptures,
        mountRetentionSealed: Boolean(state.sealed)
      };
    }

    async function flush() {
      if (state.sealed) return summary();
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(settleMs) || 0) + 20));
      for (const section of document.querySelectorAll(turnSelector)) {
        const id = sectionId(section);
        if (id) state.seenTurnIds[id] = true;
      }
      crawler.capture();
      state.flushCaptures++;
      return summary();
    }

    crawler.mountRetentionSummary = summary;
    crawler.flushMountRetention = flush;
    crawler.sealMountRetention = async () => {
      if (state.sealed) return summary();
      await flush();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      observer?.disconnect?.();
      state.sealed = true;
      // One final explicit observation after disconnect establishes the exact
      // retained state against which final targeted closure is performed.
      crawler.capture();
      state.flushCaptures++;
      return summary();
    };

    const baseStats = crawler.stats.bind(crawler);
    crawler.stats = () => ({ ...baseStats(), ...summary() });
    crawler.__mountRetentionInstalled = true;
  }, {
    settleMs,
    maxReportedMissingTurns: MAX_REPORTED_MISSING_TURNS,
    semanticAttributeFilter: SEMANTIC_ATTRIBUTE_FILTER
  });
}
