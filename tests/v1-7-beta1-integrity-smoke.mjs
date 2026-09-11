import assert from 'node:assert/strict';
import { evaluateArchiveIntegrity } from '../src/archive-integrity.mjs';

const clean = evaluateArchiveIntegrity({
  seenMountedUnretainedTurns: 0,
  scanLimitEvents: 0,
  oldestConverged: true,
  retainedUnresolvedDisclosures: 0,
  reconciliationConverged: true,
  expansionLimitEvents: 0,
  hydrationTimeoutEvents: 0,
  hydrationConflictsResolved: 2,
  hydrationConflictsUnresolved: 0
});
assert.equal(clean.status, 'verified');
assert.equal(clean.verifiedComplete, true);
assert.equal(clean.hydrationConflictsResolved, 2);

const warning = evaluateArchiveIntegrity({
  seenMountedUnretainedTurns: 1,
  seenMountedUnretainedTurnIds: ['conversation-turn-8'],
  scanLimitEvents: 1,
  oldestConverged: false,
  oldestChecks: 180,
  retainedUnresolvedTurns: 1,
  retainedUnresolvedDisclosures: 2,
  retainedUnresolvedTurnIds: ['conversation-turn-12'],
  reconciliationConverged: false,
  expansionLimitEvents: 1,
  hydrationTimeoutEvents: 2,
  hydrationConflictsResolved: 3,
  hydrationConflictsUnresolved: 1,
  hydrationConflictTurnIds: ['conversation-turn-47']
});
assert.equal(warning.status, 'warning');
assert.equal(warning.verifiedComplete, false);
assert.equal(warning.hydrationConflictsResolved, 3);
assert.equal(warning.hydrationConflictsUnresolved, 1);
assert.ok(warning.warnings.some(item => item.code === 'hydration-conflict-unresolved'));
assert.deepEqual(
  warning.warnings.find(item => item.code === 'hydration-conflict-unresolved').turnIds,
  ['conversation-turn-47']
);
assert.ok(warning.warnings.some(item => item.code === 'traversal-not-converged'));
assert.ok(warning.warnings.some(item => item.code === 'hydration-timeout'));

console.log('v1.7 beta1 archive integrity smoke test passed');
