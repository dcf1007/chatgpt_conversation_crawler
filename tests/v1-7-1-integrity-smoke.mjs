import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateArchiveIntegrity } from '../src/archive-integrity.mjs';

const clean = evaluateArchiveIntegrity({
  oldestConverged: true,
  turnProcessingFailures: 0,
  retainedUnresolvedDisclosures: 0,
  hydrationConflictsUnresolved: 0
});
assert.equal(clean.status, 'verified');
assert.equal(clean.warningCount, 0);

const warning = evaluateArchiveIntegrity({
  oldestConverged: true,
  turnProcessingFailures: 2,
  turnProcessingFailureTurnIds: ['conversation-turn-14', 'conversation-turn-44'],
  hydrationConflictsUnresolved: 1,
  hydrationConflictTurnIds: ['conversation-turn-38']
});
assert.equal(warning.status, 'warning');
assert.equal(warning.warningCount, 2);
assert.deepEqual(warning.warnings[0].turnIds, ['conversation-turn-14', 'conversation-turn-44']);
assert.equal(warning.warnings[0].code, 'turn-processing-not-converged');
assert.match(warning.warnings[1].message, /semantic evidence from competing observed hydration generations/);

const manualSource = fs.readFileSync(new URL('../src/manual-inspection.mjs', import.meta.url), 'utf8');
assert.match(manualSource, /archiveState\.integrity\s*=\s*evaluateArchiveIntegrity\(currentStats\)/,
  'diagnostic snapshots must attach centralized integrity to their detached state before snapshot construction');
assert.doesNotMatch(manualSource, /window\.__archiveCrawler\.state\.integrity\s*=/,
  'diagnostic integrity evaluation must not mutate live retained crawler state');

console.log('v1.7.1 turn-processing and diagnostic-integrity smoke test passed');
