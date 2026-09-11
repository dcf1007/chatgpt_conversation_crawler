import assert from 'node:assert/strict';
import fs from 'node:fs';
import { installCrawlerNavigation } from '../src/crawler-navigation.mjs';

const traversalSource = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
const previousInnerHeight = globalThis.innerHeight;

let top = 1000;
let client = 1000;
let leadingTurn = 2;
let leadingTop = 100;
const applied = [];
const crawler = {
  state: {},
  metrics() {
    return { top, height: 100_000, client };
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

  // Exact positioning must remain exact and must not mutate assisted-navigation
  // state. Endpoint positioning must remain exact.
  const initialResets = window.__archiveCrawlerNavigation.directionResets;
  crawler.setTop(1400);
  crawler.setTop(0);
  assert.equal(applied.at(-1), 0, 'exact setTop(0) must always land at the requested endpoint');
  assert.equal(window.__archiveCrawlerNavigation.directionResets, initialResets);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  top = 1000;
  crawler.navigateTop(1400);
  assert.equal(applied.at(-1), 1400);
  assert.equal(window.__archiveCrawlerNavigation.lastLeadingTurn, 'conversation-turn-2');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  leadingTurn = 4;
  leadingTop = 100;
  crawler.navigateTop(1800);
  assert.equal(applied.at(-1), 1800, 'advancing active leading edge must preserve requested scroll');
  assert.equal(window.__archiveCrawlerNavigation.lastLogicalProgress, true);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  // A large single turn can remain the leading turn across several viewport
  // moves. Its own movement through the viewport is real progress and must not
  // trigger an amplified jump that could skip lazy/nested content.
  leadingTop = -300;
  crawler.navigateTop(2200);
  assert.equal(applied.at(-1), 2200, 'same-turn viewport motion must count as progress');
  assert.equal(window.__archiveCrawlerNavigation.lastLogicalProgress, true);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  crawler.navigateTop(2600);
  assert.equal(applied.at(-1), 2600);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 1);

  crawler.navigateTop(3000);
  assert.ok(applied.at(-1) > 3000, 'second genuine same-direction stagnation must amplify displacement');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 2);
  assert.equal(window.__archiveCrawlerNavigation.amplifiedRequests, 1);

  // Exact endpoint moves remain exact even after the assisted path has reached
  // an amplified/stagnant state.
  crawler.setTop(0);
  assert.equal(applied.at(-1), 0);
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 2, 'exact positioning must not secretly rewrite assisted state');

  crawler.resetNavigation();
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);
  assert.equal(window.__archiveCrawlerNavigation.lastDirection, 0);

  // Browser zoom changes CSS-pixel client height. Exact endpoint behavior must
  // remain invariant when client jumps from 1000 to 4000 as seen in diagnostics.
  client = 4000;
  top = 5000;
  crawler.setTop(0);
  assert.equal(applied.at(-1), 0, 'zoom-sized client changes must not amplify exact top positioning');
  crawler.setTop(520);
  assert.equal(applied.at(-1), 520, 'capped oldest-edge probes must still use exact positioning');
  crawler.setTop(0);
  assert.equal(applied.at(-1), 0);

  assert.match(
    traversalSource,
    /OLDEST_PROBE_MAX_NUDGE_PX\s*=\s*520/,
    'oldest-edge remount probes must be capped when browser zoom inflates the CSS viewport'
  );
  assert.match(
    traversalSource,
    /if \(!scanConverged \|\| !sameFingerprint\) return 0/,
    'a traversal that failed endpoint convergence must never count as a stable reconciliation pass'
  );

  client = 1000;
  top = 2000;
  leadingTurn = 2;
  leadingTop = 100;
  crawler.resetNavigation();
  crawler.navigateTop(1200);
  assert.equal(applied.at(-1), 1200, 'reverse recovery starts a new directional baseline');
  assert.equal(window.__archiveCrawlerNavigation.stagnantSteps, 0);

  leadingTurn = 4;
  crawler.navigateTop(1600);
  assert.equal(applied.at(-1), 1600, 'downward recovery after reset must not inherit stale high-water state');
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

console.log('exact/assisted virtualizer navigation contract smoke test passed');
