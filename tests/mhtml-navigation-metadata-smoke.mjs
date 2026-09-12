import assert from 'node:assert/strict';
import fs from 'node:fs';

const recorder = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('../src/mhtml-dev-hook.mjs', import.meta.url), 'utf8');
const metadata = fs.readFileSync(new URL('../src/mhtml-manifest-metadata.mjs', import.meta.url), 'utf8');

for (const field of [
  'visibilityState',
  'documentHidden',
  'documentHasFocus',
  'focusEmulation',
  'idleOverride',
  'lifecycleActive',
  'foregroundReassertions',
  'focusEventCount',
  'blurEventCount',
  'visibilityChangeCount',
  'navigationStagnantSteps',
  'navigationLogicalProgress',
  'navigationRequestedTop',
  'navigationAppliedTop',
  'navigationLeadingTurn',
  'navigationTrailingTurn',
  'navigationAmplifiedRequests',
  'navigationDirectionResets',
  'navigationAmplifiedRequestsDelta',
  'summary.json',
  'coalescedRequests'
]) {
  assert.ok(recorder.includes(field), `MHTML recorder instrumentation missing ${field}`);
}
assert.doesNotMatch(recorder, /createHash|sha256/i, 'dev2.1 recorder must not hash complete MHTML snapshots');

for (const field of [
  'retainedRevision',
  'retainedCorpusFingerprint',
  'turnRevisionMap',
  'hydrationConflictTurnIdsFull',
  'turnProcessingFailureTurnIdsFull',
  'hydrationTimeoutTurnIdsFull',
  'retainedUnresolvedTurnIdsFull',
  'actionableLogicalKeys',
  'disclosureByTurn',
  'mountRetentionSealed',
  'activeTurnId',
  'atPhysicalBottom'
]) {
  assert.ok(hook.includes(field), `MHTML rich page sampler missing ${field}`);
}

for (const field of [
  'semanticSignatureHash',
  'mountedTurnIdsHash',
  'retainedTurnIdsHash',
  'turnRevisionMapHash',
  'changedTurnIds',
  'newlyRetainedTurnIds',
  'newHydrationConflictTurnIds',
  'resolvedHydrationConflictTurnIds',
  'newTurnProcessingFailureTurnIds',
  'newHydrationTimeoutTurnIds',
  'newUnresolvedTurnIds',
  'resolvedUnresolvedTurnIds'
]) {
  assert.ok(metadata.includes(field), `MHTML manifest metadata compactor missing ${field}`);
}

console.log('MHTML enriched navigation/semantic metadata contract smoke test passed');
