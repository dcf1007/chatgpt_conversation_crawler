import { expandTurn } from './crawler-expansion.mjs';
import { navigateToRetainedTurn } from './crawler-navigation.mjs';

const TURN_COVERAGE_MAX_ROUNDS = 4;
const TURN_COVERAGE_SETTLE_MS = 180;
const TURN_COVERAGE_QUIET_SAMPLES = 3;
const TURN_COVERAGE_BAND_FRACTION = 0.72;
const TURN_PROCESS_MAX_ROUNDS = 6;
const TURN_EXPANSION_ACTION_LIMIT = 500;

function turnNumber(turnId) {
  return Number(/conversation-turn-(\d+)/.exec(turnId || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
}

export async function retainedTurnIds(page) {
  return page.evaluate(() => Object.keys(window.__archiveCrawler?.state?.turns || {}))
    .then(ids => ids.sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right)));
}

async function sampleTurn(page, turnId) {
  return page.evaluate(id => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler.metrics();
    const section = document.querySelector(`section[data-testid="${id}"]`);
    const retained = crawler.state?.turns?.[id];
    if (!section) {
      return {
        mounted: false,
        revision: Number(crawler.turnRevision?.(id) || 0),
        remaining: Number(retained?.remaining || 0),
        top: Number(metrics.top || 0),
        height: Number(metrics.height || 0),
        client: Number(metrics.client || 0),
        turnHeight: 0,
        mountedIds: []
      };
    }

    const selector = 'section[data-testid^="conversation-turn-"]';
    const mountedIds = [...document.querySelectorAll(selector)]
      .map(turn => turn.getAttribute('data-testid'))
      .filter(Boolean);
    const rect = section.getBoundingClientRect();
    return {
      mounted: true,
      revision: Number(crawler.turnRevision?.(id) || 0),
      remaining: Number(retained?.remaining || 0),
      top: Number(metrics.top || 0),
      height: Number(metrics.height || 0),
      client: Number(metrics.client || 0),
      turnHeight: Number(rect.height || 0),
      turnTop: Number(rect.top || 0),
      turnBottom: Number(rect.bottom || 0),
      mountedIds
    };
  }, turnId);
}

async function positionTurnBoundary(page, turnId, block) {
  return page.evaluate(({ id, blockValue }) => {
    const section = document.querySelector(`section[data-testid="${id}"]`);
    if (!section) return false;
    section.scrollIntoView({ block: blockValue, inline: 'nearest' });
    window.__archiveCrawler?.resetNavigation?.();
    return true;
  }, { id: turnId, blockValue: block });
}

async function positionTurnBand(page, turnId, offsetPx) {
  return page.evaluate(({ id, requestedOffset }) => {
    const crawler = window.__archiveCrawler;
    const section = document.querySelector(`section[data-testid="${id}"]`);
    if (!section) return { mounted: false };

    function scrollRoot() {
      let element = document.querySelector('#thread') || document.querySelector('main#main') || document.querySelector('main');
      while (element && element !== document.documentElement) {
        const style = getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 32) return element;
        element = element.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    const root = scrollRoot();
    const documentRoot = root === document.scrollingElement || root === document.documentElement || root === document.body;
    const rootRect = documentRoot
      ? { top: 0 }
      : root.getBoundingClientRect();
    const metrics = crawler.metrics();
    const rect = section.getBoundingClientRect();
    const maximumTop = Math.max(0, Number(metrics.height || 0) - Number(metrics.client || 0));
    const turnTopInScroll = Number(metrics.top || 0) + Number(rect.top || 0) - Number(rootRect.top || 0);
    const maximumTurnOffset = Math.max(0, Number(rect.height || 0) - Number(metrics.client || 0));
    const offset = Math.max(0, Math.min(maximumTurnOffset, Number(requestedOffset || 0)));
    const targetTop = Math.max(0, Math.min(maximumTop, turnTopInScroll + offset));
    crawler.setTop(targetTop);
    return {
      mounted: true,
      targetTop,
      offset,
      maximumTurnOffset,
      turnHeight: Number(rect.height || 0),
      client: Number(metrics.client || 0)
    };
  }, { id: turnId, requestedOffset: offsetPx });
}

async function captureCoveragePosition(page, turnId, settleMs = TURN_COVERAGE_SETTLE_MS) {
  await page.waitForTimeout(settleMs);
  await page.evaluate(id => {
    window.__archiveCrawler.capture();
    return window.__archiveCrawler.captureTurn(id);
  }, turnId);
  return sampleTurn(page, turnId);
}

/**
 * Expose the complete CURRENT geometry of one mounted turn. Short turns get
 * start/end observations; tall turns are covered by overlapping viewport bands.
 * Every band position is recomputed from live DOM geometry and discarded after
 * use, so turn growth during hydration cannot make a historical page pixel an
 * authority. Neighbor mount changes are captured but do not block convergence.
 */
export async function stabilizeTurnCoverage(page, turnId, { shouldCancel, onProgress } = {}) {
  let lastNeighborhood = '';
  let neighborhoodChanges = 0;
  let positionsVisited = 0;

  for (let round = 1; round <= TURN_COVERAGE_MAX_ROUNDS; round++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const startSample = await sampleTurn(page, turnId);
    if (!startSample.mounted) {
      return { converged: false, reason: 'turn-unmounted', rounds: round - 1, positionsVisited, neighborhoodChanges };
    }
    const revisionBefore = startSample.revision;

    if (!await positionTurnBoundary(page, turnId, 'start')) {
      return { converged: false, reason: 'turn-unmounted', rounds: round - 1, positionsVisited, neighborhoodChanges };
    }
    let sample = await captureCoveragePosition(page, turnId);
    positionsVisited++;
    if (!sample.mounted) return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };

    const neighborhood = sample.mountedIds.join('|');
    if (lastNeighborhood && neighborhood !== lastNeighborhood) neighborhoodChanges++;
    lastNeighborhood = neighborhood;

    let offset = Math.max(160, Math.floor(Number(sample.client || 0) * TURN_COVERAGE_BAND_FRACTION));
    while (sample.mounted && Number(sample.turnHeight || 0) > Number(sample.client || 0) + 4) {
      if (shouldCancel?.()) throw new Error('Archive cancelled.');
      const maximumOffset = Math.max(0, Number(sample.turnHeight || 0) - Number(sample.client || 0));
      if (offset >= maximumOffset - 4) break;
      const positioned = await positionTurnBand(page, turnId, offset);
      if (!positioned.mounted) return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };
      sample = await captureCoveragePosition(page, turnId);
      positionsVisited++;
      if (!sample.mounted) return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };
      const currentNeighborhood = sample.mountedIds.join('|');
      if (lastNeighborhood && currentNeighborhood !== lastNeighborhood) neighborhoodChanges++;
      lastNeighborhood = currentNeighborhood;
      offset += Math.max(160, Math.floor(Number(sample.client || 0) * TURN_COVERAGE_BAND_FRACTION));
    }

    if (!await positionTurnBoundary(page, turnId, 'end')) {
      return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };
    }
    sample = await captureCoveragePosition(page, turnId);
    positionsVisited++;
    if (!sample.mounted) return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };

    let quietSamples = 1;
    let previousRevision = sample.revision;
    while (quietSamples < TURN_COVERAGE_QUIET_SAMPLES) {
      if (shouldCancel?.()) throw new Error('Archive cancelled.');
      sample = await captureCoveragePosition(page, turnId);
      positionsVisited++;
      if (!sample.mounted) return { converged: false, reason: 'turn-unmounted', rounds: round, positionsVisited, neighborhoodChanges };
      if (sample.revision === previousRevision) quietSamples++;
      else quietSamples = 1;
      previousRevision = sample.revision;
    }

    const revisionAfter = sample.revision;
    await onProgress?.({
      phase: 'Stabilizing retained turn',
      detail: `Covered the current viewport extent of ${turnId} and waited for retained semantic hydration.`,
      scanningStatus: `${turnId} · coverage round ${round}/${TURN_COVERAGE_MAX_ROUNDS} · revision ${revisionBefore}→${revisionAfter} · positions ${positionsVisited}`,
      scanComplete: false
    });

    if (revisionAfter === revisionBefore) {
      return {
        converged: true,
        reason: 'semantic-coverage-fixed-point',
        rounds: round,
        positionsVisited,
        neighborhoodChanges,
        revision: revisionAfter,
        remaining: sample.remaining,
        turnHeight: sample.turnHeight
      };
    }
  }

  await page.evaluate(value => window.__archiveCrawler.noteHydrationTimeout?.(value), {
    turnId,
    kind: 'turn-viewport-coverage',
    waitMs: TURN_COVERAGE_MAX_ROUNDS * TURN_COVERAGE_SETTLE_MS
  });
  const finalSample = await sampleTurn(page, turnId);
  return {
    converged: false,
    reason: 'coverage-round-limit',
    rounds: TURN_COVERAGE_MAX_ROUNDS,
    positionsVisited,
    neighborhoodChanges,
    revision: finalSample.revision,
    remaining: finalSample.remaining
  };
}

/**
 * Process one retained turn to a semantic fixed point: mount by identity,
 * cover the complete live turn, expand only disclosures owned by that turn,
 * then cover it again because expansion can change both height and lazy content.
 */
export async function processTurnToFixedPoint(
  page,
  turnId,
  retainedIds,
  { shouldCancel, onProgress, maxRounds = TURN_PROCESS_MAX_ROUNDS } = {}
) {
  let totalExpansionActions = 0;
  let totalCoveragePositions = 0;
  let lastRevision = -1;

  for (let round = 1; round <= maxRounds; round++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const navigation = await navigateToRetainedTurn(page, turnId, retainedIds, { shouldCancel, onProgress });
    if (!navigation.found) {
      return { converged: false, reason: 'turn-navigation-failed', rounds: round - 1, navigation, totalExpansionActions, totalCoveragePositions };
    }

    const beforeCoverage = await stabilizeTurnCoverage(page, turnId, { shouldCancel, onProgress });
    totalCoveragePositions += Number(beforeCoverage.positionsVisited || 0);
    if (!beforeCoverage.converged && beforeCoverage.reason === 'turn-unmounted') continue;

    const expansion = await expandTurn(page, turnId, TURN_EXPANSION_ACTION_LIMIT, onProgress, shouldCancel);
    totalExpansionActions += Number(expansion.processed || 0);

    // Expansion can substantially change the turn's geometry. Re-resolve the
    // same identity before covering the new height; do not assume it stayed put.
    const remount = await navigateToRetainedTurn(page, turnId, retainedIds, { shouldCancel, onProgress });
    if (!remount.found) {
      return { converged: false, reason: 'post-expansion-navigation-failed', rounds: round, navigation: remount, totalExpansionActions, totalCoveragePositions };
    }

    const afterCoverage = await stabilizeTurnCoverage(page, turnId, { shouldCancel, onProgress });
    totalCoveragePositions += Number(afterCoverage.positionsVisited || 0);
    const terminal = await sampleTurn(page, turnId);
    const revisionStable = terminal.revision === Number(afterCoverage.revision ?? terminal.revision);
    const noNewExpansion = Number(expansion.processed || 0) === 0;
    const disclosureComplete = Number(terminal.remaining || 0) === 0;

    await onProgress?.({
      phase: 'Processing retained turn',
      detail: `Turn-local coverage and disclosure expansion for ${turnId}.`,
      scanningStatus: `${turnId} · turn round ${round}/${maxRounds} · revision ${terminal.revision} · remaining ${terminal.remaining} · expanded ${expansion.processed}`,
      scanComplete: false
    });

    if (beforeCoverage.converged && afterCoverage.converged && expansion.converged
        && noNewExpansion && disclosureComplete && revisionStable) {
      return {
        converged: true,
        reason: 'turn-fixed-point',
        rounds: round,
        revision: terminal.revision,
        remaining: terminal.remaining,
        totalExpansionActions,
        totalCoveragePositions,
        navigation
      };
    }

    // A round that did perform useful expansion must be followed by another
    // complete turn cycle so newly mounted nested disclosures are discoverable.
    if (terminal.revision === lastRevision && noNewExpansion && afterCoverage.converged && disclosureComplete) {
      return {
        converged: expansion.converged,
        reason: expansion.converged ? 'turn-fixed-point' : expansion.reason,
        rounds: round,
        revision: terminal.revision,
        remaining: terminal.remaining,
        totalExpansionActions,
        totalCoveragePositions,
        navigation
      };
    }
    lastRevision = terminal.revision;
  }

  const finalSample = await sampleTurn(page, turnId);
  return {
    converged: false,
    reason: 'turn-round-limit',
    rounds: maxRounds,
    revision: finalSample.revision,
    remaining: finalSample.remaining,
    totalExpansionActions,
    totalCoveragePositions
  };
}

export const __testing = {
  TURN_COVERAGE_MAX_ROUNDS,
  TURN_COVERAGE_SETTLE_MS,
  TURN_COVERAGE_QUIET_SAMPLES,
  TURN_COVERAGE_BAND_FRACTION,
  TURN_PROCESS_MAX_ROUNDS,
  TURN_EXPANSION_ACTION_LIMIT
};
