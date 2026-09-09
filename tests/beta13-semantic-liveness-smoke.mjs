import assert from 'node:assert/strict';
import { expandMounted } from '../src/crawler-expansion.mjs';
import { __testing as traversalTesting } from '../src/crawler-traversal.mjs';

function makePage(crawler) {
  global.window = { __archiveCrawler: crawler };
  return {
    async evaluate(fn, arg) { return fn(arg); },
    async waitForTimeout() {}
  };
}

function baseCrawler(overrides = {}) {
  const state = {
    retainedRevision: 0,
    turnRevisions: Object.create(null),
    disclosureCompletions: Object.create(null),
    attempts: Object.create(null),
    quiescence: {}
  };
  const crawler = {
    state,
    retainedRevision: () => state.retainedRevision,
    turnRevision: turnId => Number(state.turnRevisions[turnId] || 0),
    markDisclosureComplete({ logicalKey, turnId }) {
      if (logicalKey && turnId) state.disclosureCompletions[logicalKey] = Number(state.turnRevisions[turnId] || 0);
    },
    noteExpansionGeneration() {},
    markQuiescence(value) { state.quiescence = value; },
    captureTurn() { return this.activity(); },
    capture() { return this.activity(); },
    activity() { return { expandingStatus: '', expanded: 0, clicks: 0, failures: 0 }; },
    stats() {
      return {
        ...this.activity(),
        retainedRevision: state.retainedRevision,
        retainedCorpusFingerprint: 'stable-corpus'
      };
    },
    metrics() { return { top: 0, height: 1000, client: 800 }; },
    mountedDisclosureSample() { return { actionableCollapsed: 0, closedDetails: 0, actionableLogicalKeys: [], signature: '' }; },
    turnDisclosureSample(turnId) {
      return {
        mounted: true,
        turnId,
        actionableCollapsed: 0,
        closedDetails: 0,
        actionableLogicalKeys: [],
        signature: `volatile-${Math.random()}`
      };
    },
    ...overrides
  };
  return crawler;
}

function persistentCollapsedCrawler({ revisions = {}, disclosures = [] } = {}) {
  const activations = [];
  const crawler = baseCrawler();
  Object.assign(crawler.state.turnRevisions, revisions);

  function actionableFor(turnId = '') {
    return disclosures.filter(item => {
      if (turnId && item.turnId !== turnId) return false;
      const current = Number(crawler.state.turnRevisions[item.turnId] || 0);
      const completed = Object.prototype.hasOwnProperty.call(crawler.state.disclosureCompletions, item.logicalKey)
        ? Number(crawler.state.disclosureCompletions[item.logicalKey] || 0)
        : null;
      return completed === null || completed < current;
    });
  }

  crawler.expandOne = turnId => {
    const item = actionableFor(turnId)[0];
    if (!item) return null;
    activations.push(item.logicalKey);
    return {
      kind: 'details',
      turnId: item.turnId,
      logicalKey: item.logicalKey,
      turnRevisionBefore: Number(crawler.state.turnRevisions[item.turnId] || 0),
      description: `${item.turnId} — ${item.label}`
    };
  };

  crawler.turnDisclosureSample = turnId => {
    const actionable = actionableFor(turnId);
    return {
      mounted: true,
      turnId,
      actionableCollapsed: actionable.length,
      closedDetails: actionable.length,
      actionableLogicalKeys: actionable.map(item => item.logicalKey).sort(),
      signature: `ignored-dom-${Math.random()}`
    };
  };

  crawler.mountedDisclosureSample = () => {
    const actionable = actionableFor('');
    return {
      actionableCollapsed: actionable.length,
      closedDetails: actionable.length,
      actionableLogicalKeys: actionable.map(item => item.logicalKey).sort(),
      signature: `ignored-mounted-${Math.random()}`
    };
  };

  return { crawler, activations };
}

// Regression: beta7 could stay forever at 2/3 actionable 0 because unrelated
// mounted DOM churn changed the old signature. Beta13.1 quietness ignores that
// volatile DOM signature and converges on the actionable logical worklist.
{
  let calls = 0;
  const crawler = baseCrawler({
    expandOne() {
      calls++;
      if (calls === 1) {
        return {
          kind: 'details',
          turnId: 'conversation-turn-7',
          logicalKey: 'conversation-turn-7|details|parent|0',
          turnRevisionBefore: 0,
          description: 'conversation-turn-7 — parent'
        };
      }
      return null;
    },
    turnDisclosureSample(turnId) {
      return {
        mounted: true,
        turnId,
        actionableCollapsed: 0,
        closedDetails: 0,
        actionableLogicalKeys: [],
        signature: `dom-churn-${calls}-${Math.random()}`
      };
    }
  });
  await expandMounted(makePage(crawler), 100);
  assert.ok(calls < 12, `semantic quiet convergence took too many expansion probes: ${calls}`);
}

// Regression: beta13 remembered logical disclosures only inside one
// expandMounted() call. Beta13.1 persists completion page-side, so a second
// traversal visit at the same turn revision must not reopen A/B/C.
{
  const turnId = 'conversation-turn-62';
  const disclosures = ['A', 'B', 'C'].map(label => ({
    turnId,
    label,
    logicalKey: `${turnId}|details|${label.toLowerCase()}|0`
  }));
  const { crawler, activations } = persistentCollapsedCrawler({ revisions: { [turnId]: 5 }, disclosures });
  const page = makePage(crawler);

  await expandMounted(page, 180);
  assert.deepEqual(activations, disclosures.map(item => item.logicalKey), 'first visit should process each logical disclosure once');

  await expandMounted(page, 180);
  assert.equal(activations.length, 3, 'second visit at the same retained turn revision must not restart A/B/C');
}

// Progress in turn 64 must not invalidate completion state for turn 62.
{
  const a62 = { turnId: 'conversation-turn-62', label: 'A62', logicalKey: 'conversation-turn-62|details|a62|0' };
  const a64 = { turnId: 'conversation-turn-64', label: 'A64', logicalKey: 'conversation-turn-64|details|a64|0' };
  const { crawler, activations } = persistentCollapsedCrawler({
    revisions: { 'conversation-turn-62': 5, 'conversation-turn-64': 7 },
    disclosures: [a62, a64]
  });
  crawler.state.disclosureCompletions[a62.logicalKey] = 5;
  crawler.state.disclosureCompletions[a64.logicalKey] = 6;

  await expandMounted(makePage(crawler), 50);
  assert.deepEqual(activations, [a64.logicalKey], 'only turn 64 should be eligible at its newer local revision');
  assert.equal(crawler.state.disclosureCompletions[a62.logicalKey], 5, 'turn 64 progress must not alter turn 62 completion');
}

// A genuine richer generation of the same turn makes its completed disclosure
// eligible exactly once again, then completion advances to the new revision.
{
  const item = { turnId: 'conversation-turn-9', label: 'A', logicalKey: 'conversation-turn-9|details|a|0' };
  const { crawler, activations } = persistentCollapsedCrawler({ revisions: { [item.turnId]: 2 }, disclosures: [item] });
  crawler.state.disclosureCompletions[item.logicalKey] = 1;
  const page = makePage(crawler);
  await expandMounted(page, 50);
  assert.deepEqual(activations, [item.logicalKey]);
  assert.equal(crawler.state.disclosureCompletions[item.logicalKey], 2);
  await expandMounted(page, 50);
  assert.equal(activations.length, 1, 'completion at current local revision must suppress further remount churn');
}

// Regression: expandOne() can disagree with the sampler. Stable actionable
// semantic state must be bounded rather than spinning on a 20 ms continue.
{
  let calls = 0;
  const crawler = baseCrawler({
    expandOne() { calls++; return null; },
    mountedDisclosureSample() {
      return {
        actionableCollapsed: 1,
        closedDetails: 0,
        actionableLogicalKeys: ['conversation-turn-11|control|a|0'],
        signature: `volatile-${Math.random()}`
      };
    }
  });
  await expandMounted(makePage(crawler), 100);
  assert.ok(calls < 12, `actionable/null contradiction did not terminate promptly: ${calls}`);
}

// Traversal convergence ignores activity counters and the old monotonic global
// revision, but reacts to the current retained-corpus fingerprint.
{
  const metrics = { top: 100, height: 1000, client: 800 };
  const base = {
    turns: 10,
    oldestRetained: 'conversation-turn-1',
    newestRetained: 'conversation-turn-10',
    retainedRevision: 5,
    retainedCorpusFingerprint: 'corpus-a',
    preBlocks: 3,
    codeBlocks: 4,
    mediaElements: 2,
    timelineMarkers: 1,
    retainedUnresolvedTurns: 0,
    retainedUnresolvedDisclosures: 0,
    clicks: 1,
    expanded: 1,
    failures: 0,
    expansionGeneration: 1
  };
  const first = traversalTesting.traversalProgressSignature(metrics, base);
  const activityOnly = traversalTesting.traversalProgressSignature(metrics, {
    ...base,
    clicks: 999,
    expanded: 999,
    failures: 12,
    expansionGeneration: 999,
    retainedRevision: 999
  });
  assert.equal(activityOnly, first, 'activity telemetry/global revision history must not count as current traversal progress');

  const retainedChange = traversalTesting.traversalProgressSignature(metrics, {
    ...base,
    retainedCorpusFingerprint: 'corpus-b'
  });
  assert.notEqual(retainedChange, first, 'current retained corpus change must count as traversal progress');
}

console.log('beta13.1 persistent semantic liveness smoke test passed');
