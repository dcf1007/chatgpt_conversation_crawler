import assert from 'node:assert/strict';
import { installDisclosureState } from '../src/crawler-disclosure-state.mjs';

class MockHTMLElement {}
globalThis.HTMLElement = MockHTMLElement;

const turnId = 'conversation-turn-62';
let richerCapturePending = false;
let retainedGeneration = 0;

const section = {
  getAttribute(name) { return name === 'data-testid' ? turnId : null; },
  querySelectorAll(selector) {
    if (selector === '[aria-expanded="false"]') return disclosure.expanded ? [] : [disclosure];
    if (selector === '[aria-expanded]') return [disclosure];
    if (selector === 'details:not([open])' || selector === 'details' || selector === '*') return [];
    return [];
  },
  querySelector() { return null; },
  innerText: 'synthetic giant turn',
  textContent: 'synthetic giant turn',
  outerHTML: '<section>synthetic giant turn</section>'
};

class MockDisclosure extends MockHTMLElement {
  constructor() {
    super();
    this.expanded = false;
    this.textContent = 'Inspecting Git Commit Changes and Blobs';
    this.clicks = 0;
  }
  getAttribute(name) {
    if (name === 'aria-expanded') return this.expanded ? 'true' : 'false';
    if (name === 'aria-controls') return '_r_test_';
    if (name === 'aria-label') return this.textContent;
    return null;
  }
  matches() { return false; }
  closest() { return section; }
  scrollIntoView() {}
  click() { this.expanded = true; this.clicks++; }
}

const disclosure = new MockDisclosure();
const documentMock = {
  querySelectorAll(selector) {
    if (selector === 'section[data-testid^="conversation-turn-"]') return [section];
    return [];
  }
};

globalThis.document = documentMock;
globalThis.window = globalThis;

const state = {
  turns: { [turnId]: { id: turnId, remaining: 1, htmlLength: 100, textLength: 50 } },
  attempts: Object.create(null),
  failures: Object.create(null),
  successfulExpansions: 0,
  clickCount: 0,
  lastExpansion: '',
  lastExpansionTurn: ''
};

const crawler = {
  state,
  captureTurn(targetTurnId) {
    assert.equal(targetTurnId, turnId);
    if (richerCapturePending) {
      richerCapturePending = false;
      retainedGeneration++;
      state.turns[turnId] = { ...state.turns[turnId], htmlLength: 100 + retainedGeneration };
    }
    return this.activity();
  },
  capture() { return this.activity(); },
  activity() { return { expanded: state.successfulExpansions, clicks: state.clickCount, failures: 0 }; },
  stats() { return this.activity(); }
};

globalThis.__archiveCrawler = crawler;
const page = { async evaluate(fn, arg) { return fn(arg); } };
await installDisclosureState(page);

const first = crawler.expandOne();
assert.ok(first, 'first collapsed disclosure must be actionable');
assert.equal(first.turnId, turnId);
assert.match(first.logicalKey, /^conversation-turn-62\|control\|inspecting git commit changes and blobs\|0$/);
assert.equal(first.turnRevisionBefore, 0);
assert.equal(disclosure.clicks, 1);

crawler.markDisclosureComplete({ logicalKey: first.logicalKey, turnId });
disclosure.expanded = false;
assert.equal(crawler.expandOne(), null, 'same disclosure remounted at same turn revision must be suppressed');
assert.equal(disclosure.clicks, 1);

richerCapturePending = true;
crawler.captureTurn(turnId);
assert.equal(crawler.turnRevision(turnId), 1, 'richer retained generation must advance only this turn revision');
const second = crawler.expandOne();
assert.ok(second, 'same logical disclosure must become eligible after its own turn becomes richer');
assert.equal(second.logicalKey, first.logicalKey, 'logical identity must survive the remount');
assert.equal(second.turnRevisionBefore, 1);
assert.equal(disclosure.clicks, 2);

crawler.markDisclosureComplete({ logicalKey: second.logicalKey, turnId });
disclosure.expanded = false;
assert.equal(crawler.expandOne(), null, 'completion at the new turn revision must suppress another remount');

const sample = crawler.turnDisclosureSample(turnId);
assert.equal(sample.actionableCollapsed, 0);
assert.deepEqual(sample.actionableLogicalKeys, []);
assert.equal(crawler.state.disclosureCompletions[first.logicalKey], 1);

console.log('beta13.1 page-side persistent disclosure completion smoke test passed');
