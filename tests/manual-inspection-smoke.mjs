import assert from 'node:assert/strict';
import {
  analyzeRemountWindow,
  selectTargetFromTurns,
  selectTargetsFromTurns
} from '../src/manual-inspection.mjs';

// Regression for beta9's bad second-target selection: a generic image viewer
// with several aria-expanded=false controls must not outrank a reasoning/tool
// turn merely because those controls are collapsed.
const turns = [
  {
    id: 'conversation-turn-37',
    role: 'assistant',
    remaining: 0,
    preCount: 0,
    codeCount: 0,
    textLength: 2200,
    html: '<section><button aria-expanded="false">Open image 1 of 3</button><button aria-expanded="false">Open image 2 of 3</button><button aria-expanded="false">Open image 3 of 3</button></section>'
  },
  {
    id: 'conversation-turn-38',
    role: 'assistant',
    remaining: 0,
    preCount: 61,
    codeCount: 52,
    textLength: 28038,
    html: '<section><button aria-expanded="true">Worked for 18m 18s</button><pre>tool output</pre><code>result</code></section>'
  },
  {
    id: 'conversation-turn-54',
    role: 'assistant',
    remaining: 0,
    preCount: 47,
    codeCount: 31,
    textLength: 15543,
    html: '<section><button aria-expanded="true">Worked for 26m 27s</button><pre>tool output</pre></section>'
  },
  {
    id: 'conversation-turn-60',
    role: 'assistant',
    remaining: 1,
    preCount: 3,
    codeCount: 2,
    textLength: 5000,
    html: '<section><button aria-expanded="false">Reasoning</button></section>'
  }
];

const targets = selectTargetsFromTurns(turns, { count: 2 });
assert.equal(targets.length, 2);
assert.equal(targets[0].id, 'conversation-turn-60', 'recognized unresolved reasoning should rank first');
assert.equal(targets[1].id, 'conversation-turn-38', 'rich reasoning/tool turn should beat generic image controls');
assert.ok(!targets.some(target => target.id === 'conversation-turn-37'));
assert.match(targets[1].reason, /reasoning\/tool|tool\/code/i);

const single = selectTargetFromTurns(turns, { excludeIds: ['conversation-turn-60'] });
assert.equal(single.id, 'conversation-turn-38');

// Target choice must be based on the untouched automatic corpus. Selecting two
// targets in one call must not depend on changes from a previous manual step.
const firstPass = selectTargetsFromTurns(turns, { count: 2 }).map(target => target.id);
const secondPass = selectTargetsFromTurns(turns, { count: 2 }).map(target => target.id);
assert.deepEqual(firstPass, secondPass);

// Sparse virtualizer regression: mounted first/last do not define a contiguous
// interval. A missing target between mounted predecessor/successor is bracketed.
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
const afterTarget = analyzeRemountWindow(retained, ['conversation-turn-39', 'conversation-turn-44'], 'conversation-turn-38');
assert.equal(afterTarget.relation, 'after-target');
const mounted = analyzeRemountWindow(retained, ['conversation-turn-37', 'conversation-turn-38', 'conversation-turn-39'], 'conversation-turn-38');
assert.equal(mounted.relation, 'mounted');
assert.equal(mounted.targetMounted, true);

console.log('dynamic manual target selection + sparse remount regression smoke test passed');
