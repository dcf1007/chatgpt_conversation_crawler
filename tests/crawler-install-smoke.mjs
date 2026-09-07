import assert from 'node:assert/strict';
import { installCrawler } from '../src/crawler.mjs';

class MockHTMLElement {}
globalThis.HTMLElement = MockHTMLElement;
globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
globalThis.innerHeight = 1000;
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
globalThis.getComputedStyle = () => ({ overflowY: 'visible' });

const turn = {
  getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-1' : null; },
  closest() { return this; },
  contains() { return false; },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  cloneNode() {
    return {
      outerHTML: '<section data-testid="conversation-turn-1"></section>',
      querySelectorAll() { return []; }
    };
  },
  innerText: 'hello',
  textContent: 'hello'
};

const separator = {
  getAttribute(name) { return name === 'aria-label' ? 'Today 9:09 AM' : null; },
  textContent: 'Today 9:09 AM',
  closest() { return null; },
  compareDocumentPosition() { return 4; }
};

const scrollingElement = { scrollHeight: 1000, clientHeight: 1000, scrollTop: 0 };
const documentMock = {
  scrollingElement,
  documentElement: scrollingElement,
  body: scrollingElement,
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'section[data-testid^="conversation-turn-"]') return [turn];
    if (selector === 'main [role="separator"][aria-label]') return [separator];
    return [];
  }
};

globalThis.document = documentMock;
globalThis.window = globalThis;

const page = {
  async evaluate(fn, arg) { return fn(arg); }
};

await installCrawler(page);

const markers = Object.values(globalThis.__archiveCrawler.state.timelineMarkers);
assert.equal(markers.length, 1);
assert.equal(markers[0].kind, 'timestamp');
assert.equal(markers[0].text, 'Today 9:09 AM');
assert.equal(markers[0].href, '');
assert.equal(markers[0].beforeTurn, 'conversation-turn-1');
console.log('crawler install smoke test passed');
