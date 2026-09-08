import assert from 'node:assert/strict';
import { installMountRetention } from '../src/crawler-mount-retention.mjs';

class MockElement {
  constructor(id = '', descendants = []) {
    this.id = id;
    this.descendants = descendants;
  }
  getAttribute(name) { return name === 'data-testid' ? this.id : null; }
  matches(selector) {
    return selector === 'section[data-testid^="conversation-turn-"]' && /^conversation-turn-\d+$/.test(this.id);
  }
  querySelectorAll(selector) {
    return selector === 'section[data-testid^="conversation-turn-"]' ? this.descendants : [];
  }
}

globalThis.Element = MockElement;

let observerInstance = null;
class MockMutationObserver {
  constructor(callback) {
    this.callback = callback;
    observerInstance = this;
  }
  observe() {}
  disconnect() {}
}
globalThis.MutationObserver = MockMutationObserver;

const mounted = [];
const documentMock = {
  documentElement: new MockElement(),
  querySelectorAll(selector) {
    return selector === 'section[data-testid^="conversation-turn-"]' ? [...mounted] : [];
  }
};
globalThis.document = documentMock;
globalThis.window = globalThis;

const retained = Object.create(null);
const captureCounts = Object.create(null);
globalThis.__archiveCrawler = {
  state: { turns: retained },
  captureTurn(id) {
    captureCounts[id] = (captureCounts[id] || 0) + 1;
    retained[id] = { id, textLength: captureCounts[id] };
    return {};
  },
  capture() {
    for (const section of mounted) this.captureTurn(section.id);
    return {};
  },
  stats() { return { turns: Object.keys(retained).length }; }
};

const page = { async evaluate(callback, argument) { return callback(argument); } };
await installMountRetention(page, { settleMs: 0 });
assert.ok(observerInstance, 'expected a page-side MutationObserver');

// Regression from beta8: turn 15 can mount entirely between two crawler scroll
// checkpoints. The mount observer must retain it immediately, without waiting
// for any subsequent traversal capture.
const turn15 = new MockElement('conversation-turn-15');
mounted.push(turn15);
observerInstance.callback([{ type: 'childList', addedNodes: [turn15] }]);
assert.ok(retained['conversation-turn-15']);
assert.equal(captureCounts['conversation-turn-15'], 1);

// The same must work when ChatGPT inserts a wrapper containing the turn rather
// than inserting the section as the mutation record's direct added node.
const turn47 = new MockElement('conversation-turn-47');
mounted.push(turn47);
const wrapper = new MockElement('', [turn47]);
observerInstance.callback([{ type: 'childList', addedNodes: [wrapper] }]);
assert.ok(retained['conversation-turn-47']);

await new Promise(resolve => setTimeout(resolve, 10));
const stats = globalThis.__archiveCrawler.stats();
assert.equal(stats.seenMountedTurns, 2);
assert.equal(stats.seenMountedUnretainedTurns, 0);
assert.deepEqual(stats.seenMountedUnretainedTurnIds, []);
assert.equal(stats.mountObserverImmediateCaptures, 2);
assert.ok(stats.mountObserverSettledCaptures >= 2);

// Re-mounting an already-retained turn should not perform another synchronous
// clone; it gets only the deferred richness-aware capture.
const beforeImmediate = stats.mountObserverImmediateCaptures;
observerInstance.callback([{ type: 'attributes', target: turn15, addedNodes: [] }]);
assert.equal(globalThis.__archiveCrawler.stats().mountObserverImmediateCaptures, beforeImmediate);
await new Promise(resolve => setTimeout(resolve, 10));
assert.ok(captureCounts['conversation-turn-15'] >= 2);

const summary = await globalThis.__archiveCrawler.flushMountRetention();
assert.equal(summary.seenMountedUnretainedTurns, 0);

console.log('beta9 capture-on-mount retention smoke test passed');
