import assert from 'node:assert/strict';
import { buildManifestMetadata, diagnosticSampleSignature } from '../src/mhtml-manifest-metadata.mjs';

const previous = {
  stage: 'traversal',
  phase: 'Forward discovery sweep',
  retainedTurns: 2,
  retainedRevision: 2,
  retainedCorpusFingerprint: 'fp-a',
  oldestRetained: 'conversation-turn-1',
  newestRetained: 'conversation-turn-2',
  timelineMarkers: 1,
  mountedTurnIds: ['conversation-turn-1', 'conversation-turn-2'],
  retainedTurnIds: ['conversation-turn-1', 'conversation-turn-2'],
  turnRevisionMap: { 'conversation-turn-1': 1, 'conversation-turn-2': 1 },
  hydrationConflictTurnIdsFull: ['conversation-turn-2'],
  turnProcessingFailureTurnIdsFull: [],
  hydrationTimeoutTurnIdsFull: [],
  retainedUnresolvedTurnIdsFull: ['conversation-turn-2'],
  actionableLogicalKeys: ['conversation-turn-2|control|worked for 2s|0'],
  disclosureByTurn: [{
    turnId: 'conversation-turn-2',
    turnRevision: 1,
    recognizedCollapsed: 1,
    actionableCollapsed: 1,
    closedDetails: 0,
    recognizedLogicalKeys: ['conversation-turn-2|control|worked for 2s|0'],
    actionableLogicalKeys: ['conversation-turn-2|control|worked for 2s|0'],
    closedDetailLogicalKeys: []
  }]
};

const current = {
  ...previous,
  retainedTurns: 3,
  retainedRevision: 4,
  retainedCorpusFingerprint: 'fp-b',
  newestRetained: 'conversation-turn-3',
  mountedTurnIds: ['conversation-turn-2', 'conversation-turn-3'],
  retainedTurnIds: ['conversation-turn-1', 'conversation-turn-2', 'conversation-turn-3'],
  turnRevisionMap: { 'conversation-turn-1': 2, 'conversation-turn-2': 1, 'conversation-turn-3': 1 },
  hydrationConflictTurnIdsFull: [],
  turnProcessingFailureTurnIdsFull: ['conversation-turn-3'],
  hydrationTimeoutTurnIdsFull: ['conversation-turn-3'],
  retainedUnresolvedTurnIdsFull: ['conversation-turn-3'],
  actionableLogicalKeys: ['conversation-turn-3|control|worked for 3s|0'],
  disclosureByTurn: [{
    turnId: 'conversation-turn-3',
    turnRevision: 1,
    recognizedCollapsed: 1,
    actionableCollapsed: 1,
    closedDetails: 0,
    recognizedLogicalKeys: ['conversation-turn-3|control|worked for 3s|0'],
    actionableLogicalKeys: ['conversation-turn-3|control|worked for 3s|0'],
    closedDetailLogicalKeys: []
  }]
};

const metadata = buildManifestMetadata(current, previous);
assert.equal(metadata.diagnosticSchemaVersion, 2);
assert.equal(metadata.semanticChangedSincePreviousCapture, true);
assert.deepEqual(metadata.changedTurnIds, ['conversation-turn-1', 'conversation-turn-3']);
assert.deepEqual(metadata.changedTurnRevisions, [
  { turnId: 'conversation-turn-1', from: 1, to: 2 },
  { turnId: 'conversation-turn-3', from: 0, to: 1 }
]);
assert.deepEqual(metadata.newlyRetainedTurnIds, ['conversation-turn-3']);
assert.deepEqual(metadata.resolvedHydrationConflictTurnIds, ['conversation-turn-2']);
assert.deepEqual(metadata.newTurnProcessingFailureTurnIds, ['conversation-turn-3']);
assert.deepEqual(metadata.newHydrationTimeoutTurnIds, ['conversation-turn-3']);
assert.deepEqual(metadata.newUnresolvedTurnIds, ['conversation-turn-3']);
assert.deepEqual(metadata.resolvedUnresolvedTurnIds, ['conversation-turn-2']);
assert.deepEqual(metadata.mountedTurnIds, ['conversation-turn-2', 'conversation-turn-3']);
assert.deepEqual(metadata.retainedTurnIds, ['conversation-turn-1', 'conversation-turn-2', 'conversation-turn-3']);
assert.ok(metadata.mountedTurnIdsHash);
assert.ok(metadata.turnRevisionMapHash);
assert.ok(metadata.actionableLogicalKeysHash);
assert.ok(metadata.disclosureStateHash);

const unchanged = buildManifestMetadata(current, current);
assert.equal(unchanged.semanticChangedSincePreviousCapture, false);
assert.deepEqual(unchanged.changedTurnIds, []);
assert.equal(unchanged.mountedTurnIds, undefined, 'unchanged full sets should not be repeated on every row');
assert.equal(unchanged.retainedTurnIds, undefined);
assert.equal(unchanged.actionableLogicalKeys, undefined);
assert.equal(unchanged.disclosureByTurn, undefined);
assert.equal(diagnosticSampleSignature(current), diagnosticSampleSignature({ ...current }));

console.log('MHTML manifest hash/delta compaction smoke test passed');
