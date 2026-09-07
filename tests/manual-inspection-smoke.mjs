import assert from 'node:assert/strict';
import { selectTargetFromTurns } from '../src/manual-inspection.mjs';

const collapsedTurn = selectTargetFromTurns([
  {
    id: 'conversation-turn-10',
    role: 'assistant',
    remaining: 0,
    preCount: 20,
    codeCount: 20,
    textLength: 9000,
    html: '<section><pre>rich automatic turn</pre></section>'
  },
  {
    id: 'conversation-turn-12',
    role: 'assistant',
    remaining: 0,
    preCount: 1,
    codeCount: 1,
    textLength: 1000,
    html: '<section><button aria-expanded="false">nested result</button></section>'
  }
]);

assert.equal(collapsedTurn.id, 'conversation-turn-12');
assert.equal(collapsedTurn.allCollapsedControls, 1);
assert.match(collapsedTurn.reason, /collapsed control/);

const richestToolTurn = selectTargetFromTurns([
  {
    id: 'conversation-turn-20',
    role: 'assistant',
    remaining: 0,
    preCount: 1,
    codeCount: 1,
    textLength: 4000,
    html: '<section></section>'
  },
  {
    id: 'conversation-turn-22',
    role: 'assistant',
    remaining: 0,
    preCount: 12,
    codeCount: 8,
    textLength: 8000,
    html: '<section></section>'
  }
]);

assert.equal(richestToolTurn.id, 'conversation-turn-22');
assert.match(richestToolTurn.reason, /richest retained tool\/code turn/);

console.log('manual inspection target-selection smoke test passed');
