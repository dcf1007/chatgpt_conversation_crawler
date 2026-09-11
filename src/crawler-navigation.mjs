const STAGNANT_STEPS_BEFORE_AMPLIFY = 2;
const MAX_AMPLIFICATION = 8;
const MAX_VIEWPORT_JUMP = 3;
const POSITION_PROGRESS_EPSILON_PX = 4;
const TARGET_NAVIGATION_MAX_STEPS = 600;
const TARGET_NAVIGATION_SETTLE_MS = 140;
const TARGET_LOCAL_PROBE_FRACTION = 0.22;
const TARGET_FALLBACK_STEP_FRACTION = 0.62;

function turnNumber(turnId) {
  return Number(/conversation-turn-(\d+)/.exec(turnId || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
}

/**
 * Classify the actual mounted set relative to a retained target. The mounted
 * set can be sparse; mounted first/last never imply a contiguous range.
 */
export function analyzeTurnWindow(retainedTurnIds, mountedTurnIds, targetTurnId) {
  const retained = Array.isArray(retainedTurnIds) ? retainedTurnIds : [];
  const mounted = Array.isArray(mountedTurnIds) ? mountedTurnIds : [];
  const order = new Map(retained.map((id, index) => [id, index]));
  const targetIndex = order.has(targetTurnId) ? order.get(targetTurnId) : -1;
  const mountedInOrder = mounted
    .filter(id => order.has(id))
    .map(id => ({ id, index: order.get(id) }))
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id));

  const targetMounted = mounted.includes(targetTurnId);
  const before = targetIndex >= 0
    ? mountedInOrder.filter(entry => entry.index < targetIndex).at(-1) || null
    : null;
  const after = targetIndex >= 0
    ? mountedInOrder.find(entry => entry.index > targetIndex) || null
    : null;

  let relation = 'unknown';
  if (targetMounted) relation = 'mounted';
  else if (before && after) relation = 'bracketed';
  else if (before) relation = 'before-target';
  else if (after) relation = 'after-target';

  return {
    targetIndex,
    targetMounted,
    relation,
    nearestBeforeId: before?.id || '',
    nearestBeforeIndex: before?.index ?? -1,
    nearestAfterId: after?.id || '',
    nearestAfterIndex: after?.index ?? -1,
    mountedCount: mountedInOrder.length
  };
}

/**
 * Preserve only logical turn identities while target navigation progresses.
 * Physical scroll coordinates are deliberately absent: virtualized geometry can
 * change, and a page scrollTop observed while an off-screen predecessor happens
 * to be mounted is not that predecessor's physical location.
 */
export function tightenTurnBracket(previous, analysis) {
  const bracket = previous ? { ...previous } : {
    beforeId: '',
    beforeIndex: -1,
    afterId: '',
    afterIndex: Number.POSITIVE_INFINITY
  };

  const beforeIndex = Number(analysis?.nearestBeforeIndex ?? -1);
  if (beforeIndex >= 0 && beforeIndex > Number(bracket.beforeIndex ?? -1)) {
    bracket.beforeId = String(analysis?.nearestBeforeId || '');
    bracket.beforeIndex = beforeIndex;
  }

  const afterIndex = Number(analysis?.nearestAfterIndex ?? -1);
  if (afterIndex >= 0 && afterIndex < Number(bracket.afterIndex ?? Number.POSITIVE_INFINITY)) {
    bracket.afterId = String(analysis?.nearestAfterId || '');
    bracket.afterIndex = afterIndex;
  }
  return bracket;
}

async function sampleTargetNavigation(page, targetTurnId) {
  return page.evaluate(targetId => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const selector = 'section[data-testid^="conversation-turn-"]';
    const mountedIds = [...document.querySelectorAll(selector)]
      .map(section => section.getAttribute('data-testid'))
      .filter(Boolean);
    const active = crawler.navigationWindow?.() || {};
    return {
      found: mountedIds.includes(targetId),
      mountedIds,
      top: Number(metrics.top || 0),
      height: Number(metrics.height || 0),
      client: Number(metrics.client || 0),
      leadingId: String(active.leadingId || ''),
      trailingId: String(active.trailingId || '')
    };
  }, targetTurnId);
}

async function positionMountedTurn(page, turnId, block) {
  return page.evaluate(({ id, blockValue }) => {
    const section = document.querySelector(`section[data-testid="${id}"]`);
    if (!section) return false;
    section.scrollIntoView({ block: blockValue, inline: 'nearest' });
    window.__archiveCrawler?.resetNavigation?.();
    return true;
  }, { id: turnId, blockValue: block });
}

async function focusMountedTarget(page, targetTurnId) {
  const found = await positionMountedTurn(page, targetTurnId, 'center');
  if (!found) return false;
  await page.waitForTimeout(TARGET_NAVIGATION_SETTLE_MS);
  return page.evaluate(id => Boolean(document.querySelector(`section[data-testid="${id}"]`)), targetTurnId);
}

function activeRelation(retainedTurnIds, state, targetTurnId) {
  const order = new Map(retainedTurnIds.map((id, index) => [id, index]));
  const targetIndex = order.get(targetTurnId);
  if (!Number.isInteger(targetIndex)) return 'unknown';
  const leadingIndex = order.get(state.leadingId);
  const trailingIndex = order.get(state.trailingId);
  if (Number.isInteger(trailingIndex) && trailingIndex < targetIndex) return 'before-target';
  if (Number.isInteger(leadingIndex) && leadingIndex > targetIndex) return 'after-target';
  if (Number.isInteger(leadingIndex) && Number.isInteger(trailingIndex)
      && leadingIndex < targetIndex && trailingIndex > targetIndex) return 'bracketed';
  return 'unknown';
}

async function moveCurrentViewport(page, direction, fraction) {
  return page.evaluate(({ sign, moveFraction }) => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
    const displacement = Math.max(96, Math.floor(Number(metrics.client || 0) * moveFraction));
    const nextTop = Math.max(0, Math.min(maximumTop, Number(metrics.top || 0) + sign * displacement));
    crawler.setTop(nextTop);
    return nextTop;
  }, { sign: direction, moveFraction: fraction });
}

/**
 * Navigate to one retained turn without ever restoring a historical page pixel.
 * Logical predecessor/successor identities survive virtualization. When one is
 * currently mounted it is re-resolved in the live DOM and positioned by its
 * current geometry. Fallback motion is a bounded, current-relative exact step.
 */
export async function navigateToRetainedTurn(
  page,
  targetTurnId,
  retainedTurnIds,
  {
    shouldCancel,
    onProgress,
    maxSteps = TARGET_NAVIGATION_MAX_STEPS
  } = {}
) {
  const retained = Array.isArray(retainedTurnIds) ? retainedTurnIds : [];
  const targetIndex = retained.indexOf(targetTurnId);
  if (targetIndex < 0) return { found: false, reason: 'target-not-retained', steps: 0 };

  let bracket = tightenTurnBracket(null, {});
  let steps = 0;
  let lastAnchorKey = '';
  let repeatedAnchorUses = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    steps = step + 1;
    const state = await sampleTargetNavigation(page, targetTurnId);
    if (state.found && await focusMountedTarget(page, targetTurnId)) {
      return {
        found: true,
        strategy: 'logical-turn-navigation',
        steps,
        bestBeforeId: bracket.beforeId,
        bestBeforeIndex: bracket.beforeIndex,
        bestAfterId: bracket.afterId,
        bestAfterIndex: Number.isFinite(bracket.afterIndex) ? bracket.afterIndex : -1
      };
    }

    const analysis = analyzeTurnWindow(retained, state.mountedIds, targetTurnId);
    bracket = tightenTurnBracket(bracket, analysis);

    let anchorId = '';
    let anchorBlock = '';
    let localDirection = 0;
    const mounted = new Set(state.mountedIds);

    if (bracket.beforeId && mounted.has(bracket.beforeId)) {
      anchorId = bracket.beforeId;
      anchorBlock = 'end';
      localDirection = 1;
    }
    if (bracket.afterId && mounted.has(bracket.afterId)) {
      const beforeDistance = bracket.beforeIndex >= 0 ? targetIndex - bracket.beforeIndex : Number.POSITIVE_INFINITY;
      const afterDistance = Number.isFinite(bracket.afterIndex) ? bracket.afterIndex - targetIndex : Number.POSITIVE_INFINITY;
      if (!anchorId || afterDistance < beforeDistance) {
        anchorId = bracket.afterId;
        anchorBlock = 'start';
        localDirection = -1;
      }
    }

    if (anchorId) {
      const anchorKey = `${anchorId}:${anchorBlock}`;
      repeatedAnchorUses = anchorKey === lastAnchorKey ? repeatedAnchorUses + 1 : 0;
      lastAnchorKey = anchorKey;
      const positioned = await positionMountedTurn(page, anchorId, anchorBlock);
      if (positioned) {
        await page.waitForTimeout(TARGET_NAVIGATION_SETTLE_MS);
        const afterAnchor = await sampleTargetNavigation(page, targetTurnId);
        if (afterAnchor.found && await focusMountedTarget(page, targetTurnId)) {
          return {
            found: true,
            strategy: 'logical-turn-anchor',
            steps,
            bestBeforeId: bracket.beforeId,
            bestBeforeIndex: bracket.beforeIndex,
            bestAfterId: bracket.afterId,
            bestAfterIndex: Number.isFinite(bracket.afterIndex) ? bracket.afterIndex : -1
          };
        }
        if (repeatedAnchorUses > 0) {
          await moveCurrentViewport(page, localDirection, TARGET_LOCAL_PROBE_FRACTION);
          await page.waitForTimeout(TARGET_NAVIGATION_SETTLE_MS);
        }
      }
    } else {
      const relation = activeRelation(retained, state, targetTurnId);
      let direction = relation === 'after-target' ? -1 : 1;
      if (relation === 'unknown') {
        const visibleNumber = turnNumber(state.leadingId || state.trailingId);
        const targetNumber = turnNumber(targetTurnId);
        if (Number.isFinite(visibleNumber) && Number.isFinite(targetNumber)) direction = visibleNumber > targetNumber ? -1 : 1;
      }
      await moveCurrentViewport(page, direction, TARGET_FALLBACK_STEP_FRACTION);
      await page.waitForTimeout(TARGET_NAVIGATION_SETTLE_MS);
    }

    if (step % 20 === 0) {
      await onProgress?.({
        phase: 'Locating retained turn',
        detail: `Navigating by retained turn identity to ${targetTurnId}.`,
        scanningStatus: `Target ${targetTurnId} · logical step ${steps}/${maxSteps} · bracket ${bracket.beforeId || 'start'} → ${bracket.afterId || 'end'}`,
        scanComplete: false,
        step: steps
      });
    }
  }

  const finalState = await sampleTargetNavigation(page, targetTurnId);
  const finalAnalysis = analyzeTurnWindow(retained, finalState.mountedIds, targetTurnId);
  return {
    found: false,
    strategy: 'logical-turn-navigation',
    reason: 'target-never-mounted',
    steps,
    finalRelation: finalAnalysis.relation,
    nearestBeforeId: finalAnalysis.nearestBeforeId,
    nearestAfterId: finalAnalysis.nearestAfterId,
    bestBeforeId: bracket.beforeId,
    bestBeforeIndex: bracket.beforeIndex,
    bestAfterId: bracket.afterId,
    bestAfterIndex: Number.isFinite(bracket.afterIndex) ? bracket.afterIndex : -1
  };
}

/**
 * Install core navigation telemetry and an explicit assisted-navigation API.
 * crawler.setTop() remains the exact positioning primitive. Adaptive recovery
 * is available only through crawler.navigateTop(), so endpoint pinning and
 * oldest-edge probes cannot inherit stale directional state.
 */
export async function installCrawlerNavigation(page) {
  return page.evaluate(({ stagnantThreshold, maxAmplification, maxViewportJump, positionEpsilon }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler?.setTop || !crawler?.metrics || crawler.__coreNavigationInstalled) return false;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const parseTurn = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.NaN);
    const exactSetTop = crawler.setTop.bind(crawler);
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
      const rootRect = doc ? { top: 0, bottom: Number(innerHeight || 0) }
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
        return { id, number, top, bottom, distance: Math.abs(((top + bottom) / 2) - viewportCenter) };
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

    function resetNavigation() {
      state.stagnantSteps = 0;
      state.lastDirection = 0;
      state.bestDownLeadingNumber = Number.NEGATIVE_INFINITY;
      state.bestDownLeadingTop = Number.POSITIVE_INFINITY;
      state.bestUpLeadingNumber = Number.POSITIVE_INFINITY;
      state.bestUpLeadingTop = Number.NEGATIVE_INFINITY;
      state.lastLogicalProgress = true;
      state.lastRequestedTop = 0;
      state.lastAppliedTop = 0;
      state.lastLeadingTurn = '';
      state.lastLeadingTop = 0;
      state.lastTrailingTurn = '';
      state.lastVisibleCount = 0;
      state.directionResets++;
      return true;
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
        if (leading === state.bestDownLeadingNumber && Number.isFinite(leadingTop) && leadingTop < state.bestDownLeadingTop - positionEpsilon) {
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
      if (leading === state.bestUpLeadingNumber && Number.isFinite(leadingTop) && leadingTop > state.bestUpLeadingTop + positionEpsilon) {
        state.bestUpLeadingTop = leadingTop;
        return true;
      }
      return false;
    }

    crawler.navigationWindow = activeWindow;
    crawler.resetNavigation = resetNavigation;
    crawler.navigateTop = requestedValue => {
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
        const viewportFloor = Math.max(1, Number(metrics.client || 0)) * Math.min(maxViewportJump, state.stagnantSteps * 0.75);
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
      return exactSetTop(appliedTop);
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
  TARGET_NAVIGATION_MAX_STEPS,
  TARGET_NAVIGATION_SETTLE_MS,
  TARGET_LOCAL_PROBE_FRACTION,
  TARGET_FALLBACK_STEP_FRACTION
};
