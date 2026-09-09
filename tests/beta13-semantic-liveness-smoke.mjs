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
    attempts: Object.create(null),
    quiescence: {}
  };
  return {
    state,
    retainedRevision: () => state.retainedRevision,
    noteExpansionGeneration() {},
    markQuiescence(value) { state.quiescence = value; },
    captureTurn() { return this.activity(); },
    capture() { return this.activity(); },
    activity() { return { expandingStatus: '', expanded: 0, clicks: 0, failures: 0 }; },
    stats() { return { ...this.activity(), retainedRevision: state.retainedRevision }; },
    metrics() { return { top: 0, height: 1000, client: 800 }; },
    mountedDisclosureSample() { return { actionableCollapsed: 0, closedDetails: 0, signature: 'idle' }; },
    turnDisclosureSample(turnId) { return { mounted: true, turnId, actionableCollapsed: 0, closedDetails: 0, actionableKeys: [], signature: `volatile-${Math.random()}` }; },
    ...overrides
  };
}

// Regression: beta7 could stay forever at 2/3 actionable 0 because unrelated
// mounted DOM churn changed the old signature. Beta13 ignores that volatile
// signature and converges on semantic state.
{
  let calls = 0;
  const crawler = baseCrawler({
    expandOne() {
      calls++;
      if (calls === 1) return { kind: 'details', turnId: 'conversation-turn-7', description: 'conversation-turn-7 — opened native <details>' };
      return null;
    },
    turnDisclosureSample(turnId) {
      return { mounted: true, turnId, actionableCollapsed: 0, closedDetails: 0, actionableKeys: [], signature: `dom-churn-${calls}-${Math.random()}` };
    }
  });
  await expandMounted(makePage(crawler), 100);
  assert.ok(calls < 12, `semantic quiet convergence took too many expansion probes: ${calls}`);
}

// Regression: beta12 could reopen A/B/C after virtualizer remounts forever.
// The first repeated successful logical disclosure with no retained progress
// must yield the convergence episode.
{
  const sequence = ['A', 'B', 'C', 'A', 'B', 'C'];
  let index = 0;
  const crawler = baseCrawler({
    expandOne() {
      const label = sequence[index++ % sequence.length];
      return { kind: 'details', turnId: 'conversation-turn-62', description: `conversation-turn-62 — ${label}` };
    }
  });
  await expandMounted(makePage(crawler), 180);
  assert.equal(index, 4, 'A/B/C remount cycle should yield on the first repeated non-improving logical disclosure');
}

// A legitimate remount must remain eligible when the second activation really
// improves the retained archive.
{
  let calls = 0;
  let captures = 0;
  const crawler = baseCrawler({
    expandOne() {
      calls++;
      if (calls <= 2) return { kind: 'details', turnId: 'conversation-turn-9', description: 'conversation-turn-9 — A' };
      return null;
    },
    captureTurn() {
      captures++;
      if (captures === 2) this.state.retainedRevision++;
      return this.activity();
    }
  });
  await expandMounted(makePage(crawler), 100);
  assert.ok(captures >= 2, 'legitimate remounted disclosure should be expanded twice before quiet sampling');
  assert.equal(crawler.state.retainedRevision, 1, 'second activation should register retained progress');
}

// Regression: expandOne() can disagree with the sampler. Stable actionable
// state must be bounded rather than spinning on a 20 ms continue forever.
{
  let calls = 0;
  const crawler = baseCrawler({
    expandOne() {
      calls++;
      if (calls === 1) return { kind: 'details', turnId: 'conversation-turn-11', description: 'conversation-turn-11 — A' };
      return null;
    },
    turnDisclosureSample(turnId) {
      return { mounted: true, turnId, actionableCollapsed: 1, closedDetails: 0, actionableKeys: ['conversation-turn-11|x|A'], signature: `dom-${Math.random()}` };
    },
    mountedDisclosureSample() {
      return { actionableCollapsed: 1, closedDetails: 0, signature: 'same-actionable' };
    }
  });
  await expandMounted(makePage(crawler), 100);
  assert.ok(calls < 12, `actionable/null contradiction did not terminate promptly: ${calls}`);
}

// Traversal convergence must ignore raw crawler activity counters while still
// reacting to actual retained-corpus progress.
{
  const metrics = { top: 100, height: 1000, client: 800 };
  const base = {
    turns: 10,
    oldestRetained: 'conversation-turn-1',
    newestRetained: 'conversation-turn-10',
    retainedRevision: 5,
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
    expansionGeneration: 999
  });
  assert.equal(activityOnly, first, 'activity telemetry must not count as traversal progress');
  const retainedChange = traversalTesting.traversalProgressSignature(metrics, { ...base, retainedRevision: 6 });
  assert.notEqual(retainedChange, first, 'retained revision must count as traversal progress');
}

console.log('beta13 semantic liveness smoke test passed');
