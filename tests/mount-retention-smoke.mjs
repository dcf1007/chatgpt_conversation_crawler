import assert from 'node:assert/strict';
import { installMountRetention } from '../src/crawler-mount-retention.mjs';

class MockElement {
  constructor(id = '', descendants = [], parent = null) {
    this.id = id;
    this.descendants = descendants;
    this.parent = parent;
    for (const child of descendants) child.parent = this;
  }
  getAttribute(name) { return name === 'data-testid' ? this.id : null; }
  matches(selector) { return selector === 'section[data-testid^="conversation-turn-"]' && /^conversation-turn-\d+$/.test(this.id); }
  querySelectorAll(selector) { return selector === 'section[data-testid^="conversation-turn-"]' ? this.descendants.filter(x => x.matches(selector)) : []; }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches?.(selector)) return node; node = node.parent; }
    return null;
  }
}

globalThis.Element = MockElement;
let observerInstance = null;
class MockMutationObserver {
  constructor(callback) { this.callback = callback; observerInstance = this; }
  observe() {}
  disconnect() {}
}
globalThis.MutationObserver = MockMutationObserver;

const mounted = [];
const documentMock = {
  documentElement: new MockElement(),
  querySelectorAll(selector) { return selector === 'section[data-testid^="conversation-turn-"]' ? [...mounted] : []; }
};
globalThis.document = documentMock;
globalThis.window = globalThis;

const retained = Object.create(null);
const generations = Object.create(null);
const captureCounts = Object.create(null);
globalThis.__archiveCrawler = {
  state: { turns: retained },
  captureTurn(id) {
    captureCounts[id] = (captureCounts[id] || 0) + 1;
    const generation = generations[id] || 1;
    if (!retained[id] || generation > retained[id].generation) retained[id] = { id, generation };
    return {};
  },
  capture() { for (const section of mounted) this.captureTurn(section.id); return {}; },
  stats() { return { turns: Object.keys(retained).length }; }
};

const page = { async evaluate(callback, argument) { return callback(argument); } };
await installMountRetention(page, { settleMs: 20 });
assert.ok(observerInstance, 'expected page-side MutationObserver');

const turn15 = new MockElement('conversation-turn-15');
generations[turn15.id] = 1; mounted.push(turn15);
observerInstance.callback([{ type: 'childList', target: documentMock.documentElement, addedNodes: [turn15] }]);
assert.equal(retained[turn15.id].generation, 1);
assert.equal(captureCounts[turn15.id], 1, 'first mount must capture synchronously');

const turn47 = new MockElement('conversation-turn-47');
const wrapper = new MockElement('', [turn47]);
generations[turn47.id] = 1; mounted.push(turn47);
observerInstance.callback([{ type: 'childList', target: documentMock.documentElement, addedNodes: [wrapper] }]);
assert.equal(retained[turn47.id].generation, 1, 'wrapped turn mount must be retained');

// Critical beta11 regression: a previously retained turn remounts richer and
// disappears before the settle timer. The richer generation must already have
// been synchronously retained.
generations[turn15.id] = 2;
observerInstance.callback([{ type: 'childList', target: documentMock.documentElement, addedNodes: [turn15] }]);
assert.equal(retained[turn15.id].generation, 2, 'richer remount must capture synchronously');
mounted.splice(mounted.indexOf(turn15), 1);
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(retained[turn15.id].generation, 2, 'richer remount must survive disappearance before settle retry');

// Existing mounted turn hydrates a descendant without remounting its section.
// The owning turn is synchronously recaptured from the mutation target.
const child = new MockElement('', [], turn47);
generations[turn47.id] = 3;
observerInstance.callback([{ type: 'childList', target: child, addedNodes: [new MockElement()] }]);
assert.equal(retained[turn47.id].generation, 3, 'descendant hydration must recapture owning turn immediately');

// Text-node hydration can happen without adding/removing elements. characterData
// mutations must therefore recapture the owning turn synchronously as well.
const textNode = { parentElement: child };
generations[turn47.id] = 4;
observerInstance.callback([{ type: 'characterData', target: textNode, addedNodes: [] }]);
assert.equal(retained[turn47.id].generation, 4, 'characterData hydration must recapture owning turn immediately');

await new Promise(resolve => setTimeout(resolve, 35));
const stats = globalThis.__archiveCrawler.stats();
assert.equal(stats.seenMountedTurns, 2);
assert.equal(stats.seenMountedUnretainedTurns, 0);
assert.ok(stats.mountObserverImmediateCaptures >= 4);
assert.ok(stats.mountObserverHydrationEvents >= 1);

const summary = await globalThis.__archiveCrawler.flushMountRetention();
assert.equal(summary.seenMountedUnretainedTurns, 0);
console.log('beta11 mount/remount/hydration retention smoke test passed');
