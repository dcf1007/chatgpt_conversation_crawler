import assert from 'node:assert/strict';
import {
  analyzeTurnWindow,
  tightenTurnBracket,
  navigateToRetainedTurn
} from '../src/crawler-navigation.mjs';

const retained = Array.from({ length: 60 }, (_, index) => `conversation-turn-${index + 1}`);

// Sparse mounted turns must not be treated as a contiguous virtualizer range.
const sparse = analyzeTurnWindow(
  retained,
  ['conversation-turn-6', 'conversation-turn-40', 'conversation-turn-60'],
  'conversation-turn-44'
);
assert.equal(sparse.relation, 'bracketed');
assert.equal(sparse.nearestBeforeId, 'conversation-turn-40');
assert.equal(sparse.nearestBeforeIndex, 39);
assert.equal(sparse.nearestAfterId, 'conversation-turn-60');
assert.equal(sparse.nearestAfterIndex, 59);

// Logical progress is monotonic even if a later virtualizer sample regresses.
let bracket = tightenTurnBracket(null, sparse);
bracket = tightenTurnBracket(bracket, analyzeTurnWindow(
  retained,
  ['conversation-turn-6', 'conversation-turn-60'],
  'conversation-turn-44'
));
assert.equal(bracket.beforeId, 'conversation-turn-40');
assert.equal(bracket.beforeIndex, 39);
assert.equal(bracket.afterId, 'conversation-turn-60');
assert.equal(bracket.afterIndex, 59);
assert.equal(Object.prototype.hasOwnProperty.call(bracket, 'scrollTop'), false,
  'durable target-navigation state must never retain a page pixel coordinate');

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;

let mountedIds = ['conversation-turn-1', 'conversation-turn-2', 'conversation-turn-5'];
let top = 12000;
const positioned = [];
const exactMoves = [];

function makeSection(id) {
  return {
    getAttribute(name) { return name === 'data-testid' ? id : null; },
    scrollIntoView(options) {
      positioned.push({ id, block: options?.block || '' });
      // Re-resolving the CURRENT predecessor geometry exposes the target. The
      // old page coordinate is intentionally unrelated to this operation.
      if (id === 'conversation-turn-2' && options?.block === 'end') {
        top = 41000;
        mountedIds = ['conversation-turn-2', 'conversation-turn-3', 'conversation-turn-5'];
      }
    }
  };
}

const crawler = {
  metrics() { return { top, height: 100000, client: 1000 }; },
  setTop(value) { top = Number(value); exactMoves.push(top); return top; },
  resetNavigation() { return true; },
  navigationWindow() {
    return {
      leadingId: mountedIds[0] || '',
      trailingId: mountedIds.at(-1) || ''
    };
  }
};

globalThis.window = { __archiveCrawler: crawler };
globalThis.document = {
  querySelectorAll(selector) {
    if (selector === 'section[data-testid^="conversation-turn-"]') return mountedIds.map(makeSection);
    return [];
  },
  querySelector(selector) {
    const match = /section\[data-testid="([^"]+)"\]/.exec(selector);
    if (!match || !mountedIds.includes(match[1])) return null;
    return makeSection(match[1]);
  }
};

const page = {
  async evaluate(fn, arg) { return fn(arg); },
  async waitForTimeout() {}
};

try {
  const result = await navigateToRetainedTurn(
    page,
    'conversation-turn-3',
    ['conversation-turn-1', 'conversation-turn-2', 'conversation-turn-3', 'conversation-turn-4', 'conversation-turn-5'],
    { maxSteps: 8 }
  );
  assert.equal(result.found, true);
  assert.ok(result.steps <= 2, `target should be exposed by the current predecessor geometry, got ${result.steps} steps`);
  assert.ok(positioned.some(entry => entry.id === 'conversation-turn-2' && entry.block === 'end'));
  assert.equal(exactMoves.includes(12000), false,
    'target navigation must not replay the historical page coordinate at which the predecessor was observed');
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

console.log('logical retained-turn navigation smoke test passed');
