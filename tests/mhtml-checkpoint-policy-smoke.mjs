import assert from 'node:assert/strict';
import {
  mhtmlCheckpointSignature,
  selectMhtmlCheckpointReason
} from '../src/mhtml-checkpoint-policy.mjs';

const base = {
  mountedTurns: 8,
  retainedTurns: 60,
  retainedRevision: 140,
  scrollTop: 500,
  scrollHeight: 20_000,
  scrollClient: 900,
  mountedFirst: 'conversation-turn-20',
  mountedLast: 'conversation-turn-27',
  turnProcessingFailures: 0,
  hydrationTimeoutEvents: 0,
  hydrationConflictsUnresolved: 3,
  images: 8,
  appBlocks: 1,
  iframes: 1,
  activeTurnId: 'conversation-turn-24',
  activeTurnRevision: 4,
  activeTurnRecognizedCollapsed: 2,
  activeTurnActionableCollapsed: 1,
  activeTurnClosedDetails: 0,
  activeTurnActionableLogicalKeys: ['conversation-turn-24|reasoning|0']
};

const physicalOnly = {
  ...base,
  mountedTurns: 3,
  scrollTop: 14_000,
  scrollHeight: 41_000,
  scrollClient: 2200,
  mountedFirst: 'conversation-turn-50',
  mountedLast: 'conversation-turn-52'
};
assert.equal(selectMhtmlCheckpointReason(base, physicalOnly), '');
assert.equal(
  mhtmlCheckpointSignature(base),
  mhtmlCheckpointSignature(physicalOnly),
  'physical viewport/topology churn must be absent from the MHTML checkpoint signature'
);

assert.equal(
  selectMhtmlCheckpointReason(base, { ...base, turnProcessingFailures: 1 }),
  'turn-processing-state-change'
);
assert.equal(
  selectMhtmlCheckpointReason(base, { ...base, hydrationTimeoutEvents: 1 }),
  'hydration-timeout-state-change'
);
assert.equal(
  selectMhtmlCheckpointReason(base, { ...base, hydrationConflictsUnresolved: 4 }),
  'hydration-conflict-state-change'
);
assert.equal(
  selectMhtmlCheckpointReason(base, {
    ...base,
    activeTurnActionableCollapsed: 0,
    activeTurnActionableLogicalKeys: []
  }),
  'target-disclosure-state-change'
);

assert.equal(
  selectMhtmlCheckpointReason(base, { ...base, images: 9 }),
  '',
  'a resource DOM count alone is not an archive-fidelity checkpoint'
);
assert.equal(
  selectMhtmlCheckpointReason(base, { ...base, images: 9, retainedRevision: 141 }),
  'archive-resource-state-change'
);

console.log('MHTML semantic checkpoint policy smoke test passed');
