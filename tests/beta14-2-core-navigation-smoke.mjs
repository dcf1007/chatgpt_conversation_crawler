import assert from 'node:assert/strict';
import { installCrawlerNavigation } from '../src/crawler-navigation.mjs';

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousInnerHeight = globalThis.innerHeight;

let top = 1000;
let leadingTurn = 2;
let leadingTop = 100;
const applied = [];
const crawler = {
  state: {},
  metrics() {
    return { top, height: 100_000, client: 1000 };
  },
  setTop(value) {
    top = Number(value);
    applied.push(top);
    return top;
  },
  stats() {
    return {};
  }
};

function section(id, rect) {
  return {
    getAttribute(name) { return name === 'data-testid' ? id : null; },
    getBoundingClientRect() { return rect; }
  };
}

const docElement = {};
globalThis.innerHeight = 1000;
globalThis.window = { __archiveCrawler: crawler };
globalThis.document = {
  documentElement: docElement,
  scrollingElement: docElement,
  body: {},
  querySelector() { return null; },
  querySelectorAll() {
    // turn 1 and turn 120 deliberately remain mounted but outside the active
    // viewport. Only the moving active leading turn is navigation authority.
    return [
      section('conversation-turn-1', { top: -5000, bottom: -4900, height: 100 }),
      section(`conversation-turn-${leadingTurn}`, { top: leadingTop, bottom: leadingTop + 700, height: 700 }),
      section('conversation-turn-120', { top: 5000, bottom: 5100, height: 100 })
    ];
  }
};

const page = {
  async evaluate(fn, arg) { return fn(arg); }
};

try {
  assert.equal(await installCrawlerNavigation(page), true);
  assert.equal(await installCrawlerNavigation(page), false, 'core navigation installer must be idempotent');

  crawler.setTop(1400);
  assert.equal(applied.at(-1), 1400);
  assert.equal(window.__archiveCrawlerNavigation.lastLeadingTurn, 'conversation-turn-2');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  leadingTurn = 4;
  leadingTop = 100;
  crawler.setTop(1800);
  assert.equal(applied.at(-1), 1800, 'advancing active leading edge must preserve requested scroll');
  assert.equal(window.__archiveCrawlerNavigation.lastLogicalProgress, true);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  // A large single turn can remain the leading turn across several viewport
  // moves. Its own movement through the viewport is real progress and must not
  // trigger an amplified jump that could skip lazy/nested content.
  leadingTop = -300;
  crawler.setTop(2200);
  assert.equal(applied.at(-1), 2200, 'same-turn viewport motion must count as progress');
  assert.equal(window.__archiveCrawlerNavigation.lastLogicalProgress, true);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  crawler.setTop(2600);
  assert.equal(applied.at(-1), 2600);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 1);

  crawler.setTop(3000);
  assert.ok(applied.at(-1) > 3000, 'second genuine same-direction stagnation must amplify displacement');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 2);
  assert.equal(window.__archiveCrawlerNavigation.amplifiedRequests, 1);

  leadingTurn = 2;
  leadingTop = 100;
  crawler.setTop(1200);
  assert.equal(applied.at(-1), 1200, 'reverse recovery starts a new directional baseline');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  leadingTurn = 4;
  crawler.setTop(1600);
  assert.equal(applied.at(-1), 1600, 'downward recovery after reversal must not inherit stale high-water state');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  const stats = crawler.stats();
  assert.equal(stats.navigationAssistActive, true);
  assert.equal(stats.navigationLeadingTurn, 'conversation-turn-4');
  assert.ok(stats.navigationDirectionResets >= 3);
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousInnerHeight === undefined) delete globalThis.innerHeight;
  else globalThis.innerHeight = previousInnerHeight;
}

console.log('beta14.2 permanent core virtualizer navigation smoke test passed');
