import assert from 'node:assert/strict';
import { expandMounted } from '../src/crawler-expansion.mjs';

const turnId = 'conversation-turn-14';
const logicalKey = `${turnId}|control|reasoning|0`;
const state = {
  turnRevisions: { [turnId]: 1 },
  disclosureCompletions: Object.create(null),
  attempts: Object.create(null),
  quiescence: {}
};
let activations = 0;
let firstProgressPending = false;

function completion() {
  return Object.prototype.hasOwnProperty.call(state.disclosureCompletions, logicalKey)
    ? Number(state.disclosureCompletions[logicalKey])
    : null;
}
function actionable() {
  const completed = completion();
  return completed === null || completed < Number(state.turnRevisions[turnId] || 0);
}

const crawler = {
  state,
  turnRevision: id => Number(state.turnRevisions[id] || 0),
  expandOne(scopeTurnId = '') {
    if (scopeTurnId && scopeTurnId !== turnId) return null;
    if (!actionable()) return null;
    activations++;
    if (activations === 1) firstProgressPending = true;
    return {
      kind: 'details',
      turnId,
      logicalKey,
      turnRevisionBefore: Number(state.turnRevisions[turnId] || 0),
      description: `${turnId} — reasoning`
    };
  },
  captureTurn() {
    if (firstProgressPending) {
      firstProgressPending = false;
      state.turnRevisions[turnId]++;
    }
    return this.activity();
  },
  capture() { return this.activity(); },
  activity() { return { expanded: activations, clicks: 0, failures: 0, expandingStatus: '' }; },
  markDisclosureComplete({ logicalKey: key, turnId: id }) {
    state.disclosureCompletions[key] = Number(state.turnRevisions[id] || 0);
  },
  noteExpansionGeneration() {},
  markQuiescence(value) { state.quiescence = value; },
  turnDisclosureSample() {
    return {
      mounted: true,
      turnId,
      actionableCollapsed: actionable() ? 1 : 0,
      closedDetails: 0,
      actionableLogicalKeys: actionable() ? [logicalKey] : [],
      signature: 'ignored'
    };
  },
  mountedDisclosureSample() {
    return {
      actionableCollapsed: actionable() ? 1 : 0,
      closedDetails: 0,
      actionableLogicalKeys: actionable() ? [logicalKey] : [],
      signature: 'ignored'
    };
  },
  stats() {
    return {
      ...this.activity(),
      retainedCorpusFingerprint: `rev-${state.turnRevisions[turnId]}`,
      retainedUnresolvedTurns: actionable() ? 1 : 0,
      retainedUnresolvedDisclosures: actionable() ? 1 : 0
    };
  },
  metrics() { return { top: 0, height: 1000, client: 800 }; }
};

global.window = { __archiveCrawler: crawler };
const page = {
  async evaluate(fn, arg) { return fn(arg); },
  async waitForTimeout() {}
};

await expandMounted(page, 20);
assert.equal(activations, 2, 'a progress-producing activation must receive one verification retry at the richer revision');
assert.equal(state.turnRevisions[turnId], 2, 'first activation should retain the richer generation');
assert.equal(state.disclosureCompletions[logicalKey], 2, 'only the no-progress verification should establish completion');

await expandMounted(page, 20);
assert.equal(activations, 2, 'same-revision remount must remain suppressed after no-progress verification');

console.log('disclosure fixed-point verification smoke test passed');
