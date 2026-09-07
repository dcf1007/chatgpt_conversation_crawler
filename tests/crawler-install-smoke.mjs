import assert from 'node:assert/strict';
import { installCrawler, __testing } from '../src/crawler.mjs';

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

const installedStats = globalThis.__archiveCrawler.stats();
assert.equal(installedStats.allCollapsedControls, 0);
assert.equal(installedStats.recognizedCollapsed, 0);
assert.equal(installedStats.actionableCollapsed, 0);
assert.equal(installedStats.closedDetails, 0);
assert.equal(installedStats.requiredQuiescentRounds, 3);
assert.equal(installedStats.retainedUnresolvedTurns, 0);
assert.equal(installedStats.retainedUnresolvedDisclosures, 0);
assert.deepEqual(installedStats.unrecognizedCollapsedLabels, []);

// Successful activation must reset the retry budget. The same logical
// disclosure can remount collapsed later; attempts are not a lifetime cap.
const retryKey = 'conversation-turn-1||synthetic successful remount';
globalThis.__archiveCrawler.state.attempts[retryKey] = 3;
globalThis.__archiveCrawler.state.failures[retryKey] = 'synthetic prior failure';
globalThis.__archiveCrawler.confirm(retryKey);
assert.equal(globalThis.__archiveCrawler.state.attempts[retryKey], undefined);
assert.equal(globalThis.__archiveCrawler.state.failures[retryKey], undefined);

// Runtime race regression: the nested disclosure does not exist when the
// parent finishes hydration. It appears only while the mounted range is being
// stabilized after an empty expansion scan. expandMounted must rescan and
// process the nested generation before declaring the range quiescent.
let phase = 'parent-ready';
let mountedSamples = 0;
const processed = [];
const quiescence = { rounds: 0, requiredRounds: 3, converged: false };
let expansionGeneration = 0;

const fakeCrawler = {
  expandOne() {
    if (phase === 'parent-ready') {
      phase = 'waiting-for-nested';
      processed.push('parent');
      return { kind: 'click', key: 'parent' };
    }
    if (phase === 'nested-ready') {
      phase = 'done';
      processed.push('nested');
      return { kind: 'click', key: 'nested' };
    }
    return null;
  },
  disclosureSample(key) {
    return { present: true, expanded: true, targetExists: true, signature: `${key}-stable` };
  },
  confirm() {},
  capture() {
    return {
      expanded: processed.length,
      clicks: processed.length,
      failures: 0,
      timelineMarkers: 0,
      oldestRetained: 'conversation-turn-1',
      newestRetained: 'conversation-turn-1',
      mountedFirst: 'conversation-turn-1',
      mountedLast: 'conversation-turn-1',
      expandingStatus: processed.at(-1) || ''
    };
  },
  mountedQuiescenceSample() {
    mountedSamples++;
    if (phase === 'waiting-for-nested' && mountedSamples >= 2) phase = 'nested-ready';
    const actionableCollapsed = phase === 'nested-ready' ? 1 : 0;
    return {
      signature: `${phase}|${actionableCollapsed}`,
      allCollapsedControls: actionableCollapsed,
      recognizedCollapsed: actionableCollapsed,
      actionableCollapsed,
      closedDetails: 0,
      unrecognizedCollapsedLabels: []
    };
  },
  noteExpansionGeneration() {
    expansionGeneration++;
    quiescence.rounds = 0;
    quiescence.converged = false;
  },
  markQuiescence(value) { Object.assign(quiescence, value); },
  stats() {
    return {
      turns: 1,
      expanded: processed.length,
      clicks: processed.length,
      failures: 0,
      preBlocks: 0,
      codeBlocks: 0,
      timelineMarkers: 0,
      oldestRetained: 'conversation-turn-1',
      newestRetained: 'conversation-turn-1',
      mountedFirst: 'conversation-turn-1',
      mountedLast: 'conversation-turn-1',
      allCollapsedControls: phase === 'nested-ready' ? 1 : 0,
      recognizedCollapsed: phase === 'nested-ready' ? 1 : 0,
      actionableCollapsed: phase === 'nested-ready' ? 1 : 0,
      closedDetails: 0,
      expansionGeneration,
      quiescentRounds: quiescence.rounds,
      requiredQuiescentRounds: quiescence.requiredRounds,
      quiescenceConverged: quiescence.converged,
      unrecognizedCollapsedLabels: []
    };
  },
  metrics() { return { top: 0, height: 1000, client: 1000 }; }
};

globalThis.__archiveCrawler = fakeCrawler;
const runtimePage = {
  async evaluate(fn, arg) { return fn(arg); },
  async waitForTimeout() {}
};

await __testing.expandMounted(runtimePage, 20);
assert.deepEqual(processed, ['parent', 'nested']);
assert.equal(expansionGeneration, 2);
assert.equal(quiescence.converged, true);
assert.equal(quiescence.rounds, 3);
assert.ok(mountedSamples >= 8, 'expected repeated mounted stabilization across quiescent rounds');

console.log('crawler install + retry reset + nested quiescence smoke test passed');
