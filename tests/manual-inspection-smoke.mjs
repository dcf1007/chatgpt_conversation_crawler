import assert from 'node:assert/strict';
import { buildManualRemountDiagnosticState, selectTargetsFromTurns } from '../src/manual-inspection.mjs';
import { analyzeTurnWindow, tightenTurnBracket } from '../src/crawler-navigation.mjs';

// Regression: a generic image viewer with several aria-expanded=false controls
// must not outrank a reasoning/tool turn merely because those controls are collapsed.
const turns = [
  {
    id: 'conversation-turn-37',
    role: 'assistant',
    actionableDisclosureCount: 0,
    preCount: 0,
    codeCount: 0,
    textLength: 2200,
    html: '<section><button aria-expanded="false">Open image 1 of 3</button><button aria-expanded="false">Open image 2 of 3</button><button aria-expanded="false">Open image 3 of 3</button></section>'
  },
  {
    id: 'conversation-turn-38',
    role: 'assistant',
    actionableDisclosureCount: 0,
    preCount: 61,
    codeCount: 52,
    textLength: 28038,
    html: '<section><button aria-expanded="true">Worked for 18m 18s</button><pre>tool output</pre><code>result</code></section>'
  },
  {
    id: 'conversation-turn-54',
    role: 'assistant',
    actionableDisclosureCount: 0,
    preCount: 47,
    codeCount: 31,
    textLength: 15543,
    html: '<section><button aria-expanded="true">Worked for 26m 27s</button><pre>tool output</pre></section>'
  },
  {
    id: 'conversation-turn-60',
    role: 'assistant',
    actionableDisclosureCount: 1,
    preCount: 3,
    codeCount: 2,
    textLength: 5000,
    html: '<section><button aria-expanded="false">Reasoning</button></section>'
  }
];

const targets = selectTargetsFromTurns(turns, { count: 2 });
assert.equal(targets.length, 2);
assert.equal(targets[0].id, 'conversation-turn-60', 'actionable unresolved reasoning should rank first');
assert.equal(targets[1].id, 'conversation-turn-38', 'rich reasoning/tool turn should beat generic image controls');
assert.ok(!targets.some(target => target.id === 'conversation-turn-37'));
assert.match(targets[1].reason, /reasoning\/tool|tool\/code/i);

const single = selectTargetsFromTurns(turns, { count: 1, excludeIds: ['conversation-turn-60'] })[0];
assert.equal(single.id, 'conversation-turn-38');

const firstPass = selectTargetsFromTurns(turns, { count: 2 }).map(target => target.id);
const secondPass = selectTargetsFromTurns(turns, { count: 2 }).map(target => target.id);
assert.deepEqual(firstPass, secondPass);

const remountDescriptor = buildManualRemountDiagnosticState(
  { id: 'conversation-turn-14', reason: 'rich assistant reasoning/tool turn' },
  { index: 2, count: 2 }
);
assert.equal(remountDescriptor.phase, 'remounting-target');
assert.equal(remountDescriptor.active, false);
assert.equal(remountDescriptor.stepIndex, 2);
assert.equal(remountDescriptor.stepCount, 2);
assert.equal(remountDescriptor.targetTurnId, 'conversation-turn-14');
assert.equal(remountDescriptor.targetReason, 'rich assistant reasoning/tool turn');
assert.equal(remountDescriptor.interactionCount, 0);
assert.equal(remountDescriptor.finishRequested, false);

const retained = Array.from({ length: 60 }, (_, index) => `conversation-turn-${index + 1}`);
const sparseMounted = [27, 37, 39, 44, 45, 46, 47, 48, 56, 57, 58, 59, 60]
  .map(number => `conversation-turn-${number}`);
const bracketed = analyzeTurnWindow(retained, sparseMounted, 'conversation-turn-38');
assert.equal(bracketed.relation, 'bracketed');
assert.equal(bracketed.nearestBeforeId, 'conversation-turn-37');
assert.equal(bracketed.nearestAfterId, 'conversation-turn-39');
assert.equal(bracketed.targetMounted, false);

const beforeTarget = analyzeTurnWindow(retained, ['conversation-turn-27', 'conversation-turn-37'], 'conversation-turn-38');
assert.equal(beforeTarget.relation, 'before-target');
const afterTarget = analyzeTurnWindow(retained, ['conversation-turn-39', 'conversation-turn-44'], 'conversation-turn-38');
assert.equal(afterTarget.relation, 'after-target');
const mounted = analyzeTurnWindow(retained, ['conversation-turn-37', 'conversation-turn-38', 'conversation-turn-39'], 'conversation-turn-38');
assert.equal(mounted.relation, 'mounted');
assert.equal(mounted.targetMounted, true);

let best = tightenTurnBracket(null, {
  nearestBeforeId: 'conversation-turn-13',
  nearestBeforeIndex: 12,
  nearestAfterId: 'conversation-turn-27',
  nearestAfterIndex: 26
});
best = tightenTurnBracket(best, {
  nearestBeforeId: 'conversation-turn-6',
  nearestBeforeIndex: 5,
  nearestAfterId: 'conversation-turn-40',
  nearestAfterIndex: 39
});
assert.equal(best.beforeId, 'conversation-turn-13');
assert.equal(best.beforeIndex, 12);
assert.equal(best.afterId, 'conversation-turn-27');
assert.equal(best.afterIndex, 26);
assert.equal(Object.prototype.hasOwnProperty.call(best, 'scrollTop'), false);

console.log('beta3 manual target selection + truthful remount metadata + shared logical remount smoke test passed');
