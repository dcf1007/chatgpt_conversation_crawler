import assert from 'node:assert/strict';
import { expandMounted } from '../src/crawler-expansion.mjs';

const turnId = 'conversation-turn-14';
const logicalKey = `${turnId}|details|reasoning|0`;
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
      closedDetails: actionable() ? 1 : 0,
      actionableLogicalKeys: actionable() ? [logicalKey] : [],
      signature: 'ignored'
    };
  },
  mountedDisclosureSample() {
    return {
      actionableCollapsed: actionable() ? 1 : 0,
      closedDetails: actionable() ? 1 : 0,
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
assert.equal(activations, 1, 'a confirmed progress-producing activation must not require a second no-progress verification click');
assert.equal(state.turnRevisions[turnId], 2, 'first activation should retain the richer semantic generation');
assert.equal(state.disclosureCompletions[logicalKey], 2, 'completion must be recorded at the resulting semantic revision');

await expandMounted(page, 20);
assert.equal(activations, 1, 'same-revision collapsed remount must remain suppressed');

// A genuinely newer semantic revision makes the same logical disclosure
// actionable again; completion then advances to that newer revision.
state.turnRevisions[turnId] = 3;
await expandMounted(page, 20);
assert.equal(activations, 2, 'newer semantic evidence must invalidate the older completion proof exactly once');
assert.equal(state.disclosureCompletions[logicalKey], 3);

console.log('beta3 disclosure completion-at-resulting-revision smoke test passed');
