import assert from 'node:assert/strict';
import { installCrawler } from '../src/crawler-base.mjs';

class MockHTMLElement {}
globalThis.HTMLElement = MockHTMLElement;
globalThis.Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
globalThis.innerHeight = 1000;
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
globalThis.getComputedStyle = () => ({ overflowY: 'visible' });
globalThis.location = { href: 'https://chatgpt.com/share/test' };

const state = { textLength: 120, mediaCount: 0, htmlLength: 600, elementCount: 8 };
const section = {
  getAttribute(name) { return name === 'data-testid' ? 'conversation-turn-1' : null; },
  closest() { return this; },
  contains() { return false; },
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'details' || selector === 'details:not([open])' || selector === '[aria-expanded="false"]' || selector === 'pre' || selector === 'code' || selector === 'img' || selector === 'a[href]' || selector === '[data-app-block-preview="true"]') return [];
    if (selector === 'img,svg,canvas,video') return Array.from({ length: state.mediaCount }, () => ({}));
    if (selector === '*') return Array.from({ length: state.elementCount }, () => ({}));
    return [];
  },
  cloneNode() {
    const prefix = '<section data-testid="conversation-turn-1">';
    const suffix = '</section>';
    return {
      outerHTML: prefix + 'x'.repeat(Math.max(0, state.htmlLength - prefix.length - suffix.length)) + suffix,
      querySelectorAll() { return []; }
    };
  },
  get innerText() { return 't'.repeat(state.textLength); },
  get textContent() { return this.innerText; }
};

const scrollingElement = { scrollHeight: 1000, clientHeight: 1000, scrollTop: 0 };
globalThis.document = {
  scrollingElement,
  documentElement: scrollingElement,
  body: scrollingElement,
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'section[data-testid^="conversation-turn-"]') return [section];
    return [];
  }
};
globalThis.window = globalThis;
const page = { async evaluate(fn, arg) { return fn(arg); } };

await installCrawler(page);
assert.equal(globalThis.__archiveCrawler.state.turns['conversation-turn-1'].mediaCount, 0);
assert.equal(globalThis.__archiveCrawler.state.turns['conversation-turn-1'].textLength, 120);

state.textLength = 110;
state.mediaCount = 1;
state.htmlLength = 550;
state.elementCount = 9;
globalThis.__archiveCrawler.captureTurn('conversation-turn-1');
const retained = globalThis.__archiveCrawler.state.turns['conversation-turn-1'];
assert.equal(retained.mediaCount, 1);
assert.equal(retained.textLength, 110);

console.log('beta11 media-aware retained-turn richness smoke test passed');
