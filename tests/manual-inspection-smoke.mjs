import assert from 'node:assert/strict';
import {
  KNOWN_PROBLEM_TURN_ID,
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

console.log('two-step manual inspection target-selection smoke test passed');
