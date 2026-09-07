import assert from 'node:assert/strict';
import {
  KNOWN_PROBLEM_TURN_ID,
  analyzeRemountWindow,
  selectKnownProblemTarget,
  selectTargetFromTurns
} from '../src/manual-inspection.mjs';

const turns = [
  {
    id: KNOWN_PROBLEM_TURN_ID,
    role: 'assistant',
    remaining: 0,
    preCount: 47,
    codeCount: 31,
    textLength: 16000,
    html: '<section><pre>known problem turn</pre></section>'
  },
  {
    id: 'conversation-turn-60',
    role: 'assistant',
    remaining: 0,
    preCount: 20,
    codeCount: 20,
    textLength: 9000,
    html: '<section><pre>rich automatic turn</pre></section>'
  },
  {
    id: 'conversation-turn-62',
    role: 'assistant',
    remaining: 0,
    preCount: 1,
    codeCount: 1,
    textLength: 1000,
    html: '<section><button aria-expanded="false">nested result</button></section>'
  }
];

const known = selectKnownProblemTarget(turns);
assert.equal(known.id, KNOWN_PROBLEM_TURN_ID);
assert.match(known.reason, /known problematic turn/);

const collapsedTurn = selectTargetFromTurns(turns, { excludeIds: [KNOWN_PROBLEM_TURN_ID] });
assert.equal(collapsedTurn.id, 'conversation-turn-62');
assert.equal(collapsedTurn.allCollapsedControls, 1);
assert.match(collapsedTurn.reason, /collapsed control/);

const richestToolTurn = selectTargetFromTurns([
  turns[0],
  turns[1]
], { excludeIds: [KNOWN_PROBLEM_TURN_ID] });
assert.equal(richestToolTurn.id, 'conversation-turn-60');
assert.match(richestToolTurn.reason, /richest retained tool\/code turn/);

assert.equal(selectKnownProblemTarget(turns, 'conversation-turn-999'), null);

// Regression for the dev2.1 remount failure: mountedFirst/mountedLast are not a
// contiguous range. In the observed sparse DOM, turn 38 is absent even though
// turns 37 and 39 are both mounted. The old midpoint heuristic called this an
// upward search and could fight ChatGPT's scroll anchoring forever. The new
// planner must classify it as bracketed so runtime navigation anchors turn 37
// and probes forward instead of issuing local upward scroll commands.
const retained = Array.from({ length: 60 }, (_, index) => `conversation-turn-${index + 1}`);
const sparseMounted = [27, 37, 39, 44, 45, 46, 47, 48, 56, 57, 58, 59, 60]
  .map(number => `conversation-turn-${number}`);
const bracketed = analyzeRemountWindow(retained, sparseMounted, 'conversation-turn-38');
assert.equal(bracketed.relation, 'bracketed');
assert.equal(bracketed.nearestBeforeId, 'conversation-turn-37');
assert.equal(bracketed.nearestAfterId, 'conversation-turn-39');
assert.equal(bracketed.targetMounted, false);

const beforeTarget = analyzeRemountWindow(retained, ['conversation-turn-27', 'conversation-turn-37'], 'conversation-turn-38');
assert.equal(beforeTarget.relation, 'before-target');
assert.equal(beforeTarget.nearestBeforeId, 'conversation-turn-37');
assert.equal(beforeTarget.nearestAfterId, '');

const afterTarget = analyzeRemountWindow(retained, ['conversation-turn-39', 'conversation-turn-44'], 'conversation-turn-38');
assert.equal(afterTarget.relation, 'after-target');
assert.equal(afterTarget.nearestBeforeId, '');
assert.equal(afterTarget.nearestAfterId, 'conversation-turn-39');

const mounted = analyzeRemountWindow(retained, ['conversation-turn-37', 'conversation-turn-38', 'conversation-turn-39'], 'conversation-turn-38');
assert.equal(mounted.relation, 'mounted');
assert.equal(mounted.targetMounted, true);

console.log('two-step manual inspection target-selection and sparse-remount regression smoke test passed');
