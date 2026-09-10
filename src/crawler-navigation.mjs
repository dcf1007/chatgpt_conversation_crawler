const STAGNANT_STEPS_BEFORE_AMPLIFY = 2;
const MAX_AMPLIFICATION = 8;
const MAX_VIEWPORT_JUMP = 3;
const POSITION_PROGRESS_EPSILON_PX = 4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function turnNumber(turnId) {
  const value = Number(/conversation-turn-(\d+)/.exec(String(turnId || ''))?.[1] ?? Number.NaN);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Pure displacement policy shared by automatic traversal and diagnostic
 * remounting. Requested coordinates are preserved while the active virtualized
 * window advances. Repeated same-direction logical stagnation progressively
 * increases displacement, bounded by the real scroll range.
 */
export function assistedScrollTarget({
  currentTop,
  requestedTop,
  maximumTop,
  client,
  stagnantSteps
}) {
  const current = Number(currentTop || 0);
  const maximum = Math.max(0, Number(maximumTop || 0));
  const requested = clamp(Number(requestedTop || 0), 0, maximum);
  const delta = requested - current;
  const stagnant = Math.max(0, Number(stagnantSteps || 0));
  if (!delta || stagnant < STAGNANT_STEPS_BEFORE_AMPLIFY) return requested;

  const multiplier = Math.min(MAX_AMPLIFICATION, 2 ** Math.min(3, stagnant - 1));
  const viewportFloor = Math.max(1, Number(client || 0)) * Math.min(MAX_VIEWPORT_JUMP, stagnant * 0.75);
  const displacement = Math.max(Math.abs(delta) * multiplier, viewportFloor);
  return clamp(current + Math.sign(delta) * displacement, 0, maximum);
}

/**
 * Permanent page-side navigation authority. It wraps crawler.setTop() for the
 * complete crawl, not just diagnostics. Progress is measured from the leading
 * edge of the active viewport window, so distant retained/sentinel turns and a
 * pinned newest turn cannot manufacture either progress or stagnation.
 *
 * A single very tall turn can legitimately occupy several viewports. For that
 * case, motion of the same leading turn through the viewport also counts as
 * progress. Direction reversals start a fresh baseline.
 */
export async function installCrawlerNavigation(page) {
  return page.evaluate(({ stagnantThreshold, maxAmplification, maxViewportJump, positionEpsilon }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler?.setTop || !crawler?.metrics || crawler.__coreNavigationInstalled) return false;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const parseTurn = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.NaN);
    const originalSetTop = crawler.setTop;
    const state = crawler.state.navigation = {
      active: true,
      stagnantSteps: 0,
      lastDirection: 0,
      bestDownLeadingNumber: Number.NEGATIVE_INFINITY,
      bestDownLeadingTop: Number.POSITIVE_INFINITY,
      bestUpLeadingNumber: Number.POSITIVE_INFINITY,
      bestUpLeadingTop: Number.NEGATIVE_INFINITY,
      lastLogicalProgress: true,
      lastRequestedTop: 0,
      lastAppliedTop: 0,
      lastLeadingTurn: '',
      lastLeadingTop: 0,
      lastTrailingTurn: '',
      lastVisibleCount: 0,
      amplifiedRequests: 0,
      directionResets: 0
    };
    window.__archiveCrawlerNavigation = state;

    function scrollRoot() {
      let element = document.querySelector('#thread') || document.querySelector('main#main') || document.querySelector('main');
      while (element && element !== document.documentElement) {
        const style = getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 32) return element;
        element = element.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    function activeWindow() {
      const root = scrollRoot();
      const doc = root === document.scrollingElement || root === document.documentElement || root === document.body;
      const rootRect = doc
        ? { top: 0, bottom: Number(innerHeight || 0) }
        : root?.getBoundingClientRect?.() || { top: 0, bottom: Number(innerHeight || 0) };
      const viewportTop = Number(rootRect.top || 0);
      const viewportBottom = Number(rootRect.bottom || viewportTop + Number(innerHeight || 0));
      const viewportCenter = (viewportTop + viewportBottom) / 2;
      const entries = [...document.querySelectorAll(turnSelector)].map(section => {
        const id = section.getAttribute('data-testid') || '';
        const number = parseTurn(id);
        const rect = section.getBoundingClientRect?.() || { top: 0, bottom: 0, height: 0 };
        const top = Number(rect.top || 0);
        const bottom = Number(rect.bottom ?? (top + Number(rect.height || 0)));
        return {
          id,
          number,
          top,
          bottom,
          distance: Math.abs(((top + bottom) / 2) - viewportCenter)
        };
      }).filter(entry => Number.isFinite(entry.number));

      let active = entries.filter(entry => entry.bottom > viewportTop && entry.top < viewportBottom);
      if (!active.length && entries.length) {
        active = [entries.reduce((best, entry) => entry.distance < best.distance ? entry : best, entries[0])];
      }
      active.sort((left, right) => left.number - right.number || left.id.localeCompare(right.id));
      return {
        leadingId: active[0]?.id || '',
        leadingNumber: active[0]?.number ?? Number.NaN,
        leadingTop: active[0]?.top ?? Number.NaN,
        trailingId: active.at(-1)?.id || '',
        trailingNumber: active.at(-1)?.number ?? Number.NaN,
        visibleCount: active.length
      };
    }

    function establishBaseline(direction, windowState) {
      const leading = windowState.leadingNumber;
      const leadingTop = windowState.leadingTop;
      if (!Number.isFinite(leading)) return;
      if (direction > 0) {
        state.bestDownLeadingNumber = leading;
        state.bestDownLeadingTop = Number.isFinite(leadingTop) ? leadingTop : Number.POSITIVE_INFINITY;
      } else {
        state.bestUpLeadingNumber = leading;
        state.bestUpLeadingTop = Number.isFinite(leadingTop) ? leadingTop : Number.NEGATIVE_INFINITY;
      }
    }

    function observeProgress(direction, windowState) {
      const leading = windowState.leadingNumber;
      const leadingTop = windowState.leadingTop;
      if (!Number.isFinite(leading)) return true;

      if (direction > 0) {
        if (leading > state.bestDownLeadingNumber) {
          state.bestDownLeadingNumber = leading;
          state.bestDownLeadingTop = Number.isFinite(leadingTop) ? leadingTop : Number.POSITIVE_INFINITY;
          return true;
        }
        if (leading === state.bestDownLeadingNumber && Number.isFinite(leadingTop) &&
            leadingTop < state.bestDownLeadingTop - positionEpsilon) {
          state.bestDownLeadingTop = leadingTop;
          return true;
        }
        return false;
      }

      if (leading < state.bestUpLeadingNumber) {
        state.bestUpLeadingNumber = leading;
        state.bestUpLeadingTop = Number.isFinite(leadingTop) ? leadingTop : Number.NEGATIVE_INFINITY;
        return true;
      }
      if (leading === state.bestUpLeadingNumber && Number.isFinite(leadingTop) &&
          leadingTop > state.bestUpLeadingTop + positionEpsilon) {
        state.bestUpLeadingTop = leadingTop;
        return true;
      }
      return false;
    }

    crawler.navigationWindow = activeWindow;
    crawler.setTop = requestedValue => {
      const metrics = crawler.metrics();
      const currentTop = Number(metrics.top || 0);
      const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
      const requestedTop = Math.max(0, Math.min(maximumTop, Number(requestedValue || 0)));
      const direction = Math.sign(requestedTop - currentTop);
      const windowState = activeWindow();

      let logicalProgress = true;
      if (!direction) {
        state.stagnantSteps = 0;
        state.lastDirection = 0;
      } else if (direction !== state.lastDirection) {
        state.stagnantSteps = 0;
        state.lastDirection = direction;
        state.directionResets++;
        establishBaseline(direction, windowState);
      } else {
        logicalProgress = observeProgress(direction, windowState);
        if (logicalProgress) state.stagnantSteps = 0;
        else state.stagnantSteps++;
      }

      let appliedTop = requestedTop;
      if (direction && state.stagnantSteps >= stagnantThreshold) {
        const delta = requestedTop - currentTop;
        const multiplier = Math.min(maxAmplification, 2 ** Math.min(3, state.stagnantSteps - 1));
        const viewportFloor = Math.max(1, Number(metrics.client || 0))
          * Math.min(maxViewportJump, state.stagnantSteps * 0.75);
        const displacement = Math.max(Math.abs(delta) * multiplier, viewportFloor);
        appliedTop = Math.max(0, Math.min(maximumTop, currentTop + Math.sign(delta) * displacement));
        if (appliedTop !== requestedTop) state.amplifiedRequests++;
      }

      state.lastLogicalProgress = logicalProgress;
      state.lastRequestedTop = requestedTop;
      state.lastAppliedTop = appliedTop;
      state.lastLeadingTurn = windowState.leadingId;
      state.lastLeadingTop = Number.isFinite(windowState.leadingTop) ? windowState.leadingTop : 0;
      state.lastTrailingTurn = windowState.trailingId;
      state.lastVisibleCount = windowState.visibleCount;
      return originalSetTop(appliedTop);
    };

    const baseStats = crawler.stats.bind(crawler);
    crawler.navigationSummary = () => ({
      navigationAssistActive: true,
      navigationStagnantSteps: Number(state.stagnantSteps || 0),
      navigationLogicalProgress: state.lastLogicalProgress !== false,
      navigationRequestedTop: Number(state.lastRequestedTop || 0),
      navigationAppliedTop: Number(state.lastAppliedTop || 0),
      navigationLeadingTurn: state.lastLeadingTurn || '',
      navigationLeadingTop: Number(state.lastLeadingTop || 0),
      navigationTrailingTurn: state.lastTrailingTurn || '',
      navigationVisibleTurns: Number(state.lastVisibleCount || 0),
      navigationAmplifiedRequests: Number(state.amplifiedRequests || 0),
      navigationDirectionResets: Number(state.directionResets || 0)
    });
    crawler.stats = () => ({ ...baseStats(), ...crawler.navigationSummary() });
    crawler.__coreNavigationOriginalSetTop = originalSetTop;
    crawler.__coreNavigationInstalled = true;
    return true;
  }, {
    stagnantThreshold: STAGNANT_STEPS_BEFORE_AMPLIFY,
    maxAmplification: MAX_AMPLIFICATION,
    maxViewportJump: MAX_VIEWPORT_JUMP,
    positionEpsilon: POSITION_PROGRESS_EPSILON_PX
  });
}

export const __testing = {
  STAGNANT_STEPS_BEFORE_AMPLIFY,
  MAX_AMPLIFICATION,
  MAX_VIEWPORT_JUMP,
  POSITION_PROGRESS_EPSILON_PX
};
