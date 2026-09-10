const STAGNANT_STEPS_BEFORE_AMPLIFY = 2;
const MAX_AMPLIFICATION = 8;
const MAX_VIEWPORT_JUMP = 3;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Pure policy helper used by regression tests. A requested scroll is left
 * untouched while the mounted turn window is advancing. After repeated
 * logical stagnation, the displacement is amplified so ChatGPT's virtualizer
 * is forced to mount a materially different window instead of oscillating in
 * place on small coordinate changes.
 */
export function assistedManualScrollTarget({
  currentTop,
  requestedTop,
  maximumTop,
  client,
  stagnantSteps
}) {
  const current = Number(currentTop || 0);
  const requested = clamp(Number(requestedTop || 0), 0, Math.max(0, Number(maximumTop || 0)));
  const delta = requested - current;
  const stagnant = Math.max(0, Number(stagnantSteps || 0));
  if (!delta || stagnant < STAGNANT_STEPS_BEFORE_AMPLIFY) return requested;

  const multiplier = Math.min(MAX_AMPLIFICATION, 2 ** Math.min(3, stagnant - 1));
  const viewportFloor = Math.max(1, Number(client || 0)) * Math.min(MAX_VIEWPORT_JUMP, stagnant * 0.75);
  const displacement = Math.max(Math.abs(delta) * multiplier, viewportFloor);
  return clamp(current + Math.sign(delta) * displacement, 0, Math.max(0, Number(maximumTop || 0)));
}

/**
 * Development-only navigation assist for the independent manual comparison.
 * It wraps crawler.setTop() only during manual inspection. Logical progress is
 * measured from the virtualizer's leading mounted conversation-turn edge, not
 * from scrollTop alone. ChatGPT can keep the newest turn mounted while this
 * leading edge advances, so the maximum mounted turn is not a valid forward
 * progress signal.
 */
export async function installManualScrollAssist(page) {
  return page.evaluate(({ stagnantThreshold, maxAmplification, maxViewportJump }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler?.setTop || !crawler?.metrics || crawler.__manualScrollAssistInstalled) return false;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.NaN);
    const originalSetTop = crawler.setTop;
    const state = window.__archiveManualScrollAssist = {
      active: true,
      stagnantSteps: 0,
      lastDirection: 0,
      bestDownEdge: Number.NEGATIVE_INFINITY,
      bestUpEdge: Number.POSITIVE_INFINITY,
      lastLogicalProgress: true,
      lastRequestedTop: 0,
      lastAppliedTop: 0,
      lastMountedFirst: '',
      lastMountedLast: ''
    };

    function mountedBounds() {
      const ids = [...document.querySelectorAll(turnSelector)]
        .map(turn => turn.getAttribute('data-testid'))
        .filter(Boolean);
      const values = ids.map(turnNumber).filter(Number.isFinite);
      return {
        firstId: ids[0] || '',
        lastId: ids.at(-1) || '',
        minimum: values.length ? Math.min(...values) : Number.NaN,
        maximum: values.length ? Math.max(...values) : Number.NaN
      };
    }

    crawler.setTop = requestedValue => {
      const metrics = crawler.metrics();
      const currentTop = Number(metrics.top || 0);
      const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
      const requestedTop = Math.max(0, Math.min(maximumTop, Number(requestedValue || 0)));
      const direction = Math.sign(requestedTop - currentTop);
      const bounds = mountedBounds();

      let logicalProgress = true;
      if (!direction) {
        state.stagnantSteps = 0;
        state.lastDirection = 0;
      } else if (direction !== state.lastDirection) {
        // A reversal starts a new directional run. Its current leading edge is
        // the baseline; an all-time edge from a previous run must not make the
        // recovery leg look stagnant before it reaches the old high-water mark.
        state.stagnantSteps = 0;
        state.lastDirection = direction;
        if (Number.isFinite(bounds.minimum)) {
          if (direction > 0) state.bestDownEdge = bounds.minimum;
          else state.bestUpEdge = bounds.minimum;
        }
      } else {
        if (direction > 0) {
          // The beta14 result kept conversation-turn-120 mounted throughout the
          // target search. Forward progress is therefore the leading/minimum edge
          // moving to a later turn, not the maximum mounted edge increasing.
          logicalProgress = Number.isFinite(bounds.minimum) && bounds.minimum > state.bestDownEdge;
          if (Number.isFinite(bounds.minimum)) state.bestDownEdge = Math.max(state.bestDownEdge, bounds.minimum);
        } else {
          logicalProgress = Number.isFinite(bounds.minimum) && bounds.minimum < state.bestUpEdge;
          if (Number.isFinite(bounds.minimum)) state.bestUpEdge = Math.min(state.bestUpEdge, bounds.minimum);
        }

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
      }

      state.lastLogicalProgress = logicalProgress;
      state.lastRequestedTop = requestedTop;
      state.lastAppliedTop = appliedTop;
      state.lastMountedFirst = bounds.firstId;
      state.lastMountedLast = bounds.lastId;
      return originalSetTop(appliedTop);
    };

    crawler.__manualScrollAssistOriginalSetTop = originalSetTop;
    crawler.__manualScrollAssistInstalled = true;
    return true;
  }, {
    stagnantThreshold: STAGNANT_STEPS_BEFORE_AMPLIFY,
    maxAmplification: MAX_AMPLIFICATION,
    maxViewportJump: MAX_VIEWPORT_JUMP
  });
}

export async function restoreManualScrollAssist(page) {
  return page.evaluate(() => {
    const crawler = window.__archiveCrawler;
    if (!crawler?.__manualScrollAssistInstalled) return false;
    if (crawler.__manualScrollAssistOriginalSetTop) crawler.setTop = crawler.__manualScrollAssistOriginalSetTop;
    delete crawler.__manualScrollAssistOriginalSetTop;
    delete crawler.__manualScrollAssistInstalled;
    if (window.__archiveManualScrollAssist) window.__archiveManualScrollAssist.active = false;
    return true;
  });
}

export const __testing = {
  STAGNANT_STEPS_BEFORE_AMPLIFY,
  MAX_AMPLIFICATION,
  MAX_VIEWPORT_JUMP
};
