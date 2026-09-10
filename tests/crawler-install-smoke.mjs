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
  textContent: 'hello',
  outerHTML: '<section data-testid="conversation-turn-1">hello</section>'
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
assert.equal(installedStats.quiescenceScopeTurn, '');
assert.deepEqual(installedStats.unrecognizedCollapsedLabels, []);

const turnSample = globalThis.__archiveCrawler.turnDisclosureSample('conversation-turn-1');
assert.equal(turnSample.mounted, true);
assert.equal(turnSample.turnId, 'conversation-turn-1');
assert.equal(turnSample.actionableCollapsed, 0);
assert.match(turnSample.signature, /^conversation-turn-1\|/);

// Successful activation must reset the retry budget. The same logical
// disclosure can remount collapsed later; attempts are not a lifetime cap.
const retryKey = 'conversation-turn-1||synthetic successful remount';
globalThis.__archiveCrawler.state.attempts[retryKey] = 3;
globalThis.__archiveCrawler.state.failures[retryKey] = 'synthetic prior failure';
globalThis.__archiveCrawler.confirm(retryKey);
assert.equal(globalThis.__archiveCrawler.state.attempts[retryKey], undefined);
assert.equal(globalThis.__archiveCrawler.state.failures[retryKey], undefined);

// Once beta8 activates a turn, page-side expansion must stay inside that turn
// until its nested tree converges. This prevents another mounted turn from
// stealing the fixed-point loop while a late child is still materializing.
class MockDisclosure extends MockHTMLElement {
  constructor(section, label) {
    super();
    this.section = section;
    this.textContent = label;
    this.expanded = false;
    this.clicks = 0;
  }
  getAttribute(name) {
    if (name === 'aria-expanded') return this.expanded ? 'true' : 'false';
    if (name === 'aria-controls') return '';
    if (name === 'aria-label') return this.textContent;
    return null;
  }
  matches() { return false; }
  closest() { return this.section; }
  scrollIntoView() {}
  click() { this.expanded = true; this.clicks++; }
}

function makeDisclosureTurn(id, label) {
  const section = {
    getAttribute(name) { return name === 'data-testid' ? id : null; },
    querySelector(selector) { return null; },
    querySelectorAll(selector) {
      if (selector === 'details:not([open])') return [];
      if (selector === '[aria-expanded="false"]') return disclosure.expanded ? [] : [disclosure];
      if (selector === '[aria-expanded]') return [disclosure];
      return [];
    }
  };
  const disclosure = new MockDisclosure(section, label);
  return { section, disclosure };
}

const scopedOne = makeDisclosureTurn('conversation-turn-1', 'Worked for 1m');
const scopedTwo = makeDisclosureTurn('conversation-turn-2', 'Worked for 2m');
const originalDocumentQueryAll = documentMock.querySelectorAll.bind(documentMock);
documentMock.querySelectorAll = selector => {
  if (selector === 'section[data-testid^="conversation-turn-"]') return [scopedOne.section, scopedTwo.section];
  return originalDocumentQueryAll(selector);
};
const scopedResult = globalThis.__archiveCrawler.expandOne('conversation-turn-2');
assert.equal(scopedResult.turnId, 'conversation-turn-2');
assert.equal(scopedOne.disclosure.clicks, 0);
assert.equal(scopedTwo.disclosure.clicks, 1);
documentMock.querySelectorAll = originalDocumentQueryAll;

// Runtime regression for beta7's freeze: nested content appears after the
// parent's immediate hydration, while an unrelated virtualized turn can churn.
// beta8 must converge using conversation-turn-54 only and must never consult a
// whole-mounted-DOM signature.
let phase = 'parent-ready';
let exposeNestedAfterWait = false;
let turnSamples = 0;
let mountedWholeDomSamples = 0;
const processed = [];
const quiescence = { rounds: 0, requiredRounds: 3, converged: false, scopeTurnId: '' };
let expansionGeneration = 0;

const fakeCrawler = {
  expandOne() {
    if (phase === 'parent-ready') {
      phase = 'waiting-for-nested';
      processed.push('parent');
      return { kind: 'click', key: 'parent', turnId: 'conversation-turn-54' };
    }
    if (phase === 'nested-ready') {
      phase = 'done';
      processed.push('nested');
      return { kind: 'click', key: 'nested', turnId: 'conversation-turn-54' };
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
      newestRetained: 'conversation-turn-60',
      mountedFirst: 'conversation-turn-27',
      mountedLast: 'conversation-turn-60',
      expandingStatus: processed.at(-1) || ''
    };
  },
  captureTurn(turnId) {
    assert.equal(turnId, 'conversation-turn-54');
    return this.capture();
  },
  turnDisclosureSample(turnId) {
    turnSamples++;
    assert.equal(turnId, 'conversation-turn-54');
    if (phase === 'waiting-for-nested') exposeNestedAfterWait = true;
    const actionableCollapsed = phase === 'nested-ready' ? 1 : 0;
    return {
      mounted: true,
      turnId,
      actionableCollapsed,
      recognizedCollapsed: actionableCollapsed,
      closedDetails: 0,
      // Deliberately stable once the nested generation has been processed.
      // An unrelated turn's mount state is not represented here.
      signature: phase === 'waiting-for-nested' ? 'turn54-parent-settled' : `turn54-${phase}`
    };
  },
  mountedDisclosureSample() {
    return { signature: '', actionableCollapsed: 0, recognizedCollapsed: 0, closedDetails: 0 };
  },
  mountedSample() {
    mountedWholeDomSamples++;
    return mountedWholeDomSamples % 2 ? 'turn45-present' : 'turn45-absent';
  },
  noteExpansionGeneration(turnId) {
    expansionGeneration++;
    quiescence.rounds = 0;
    quiescence.converged = false;
    quiescence.scopeTurnId = turnId;
  },
  markQuiescence(value) { Object.assign(quiescence, value); },
  stats() {
    return {
      turns: 60,
      expanded: processed.length,
      clicks: processed.length,
      failures: 0,
      preBlocks: 605,
      codeBlocks: 749,
      timelineMarkers: 3,
      oldestRetained: 'conversation-turn-1',
      newestRetained: 'conversation-turn-60',
      mountedFirst: 'conversation-turn-27',
      mountedLast: 'conversation-turn-60',
      allCollapsedControls: phase === 'nested-ready' ? 1 : 0,
      recognizedCollapsed: phase === 'nested-ready' ? 1 : 0,
      actionableCollapsed: phase === 'nested-ready' ? 1 : 0,
      closedDetails: 0,
      expansionGeneration,
      quiescentRounds: quiescence.rounds,
      requiredQuiescentRounds: quiescence.requiredRounds,
      quiescenceConverged: quiescence.converged,
      quiescenceScopeTurn: quiescence.scopeTurnId,
      unrecognizedCollapsedLabels: []
    };
  },
  metrics() { return { top: 0, height: 1000, client: 1000 }; }
};

globalThis.__archiveCrawler = fakeCrawler;
const runtimePage = {
  async evaluate(fn, arg) { return fn(arg); },
  async waitForTimeout() {
    if (exposeNestedAfterWait && phase === 'waiting-for-nested') {
      exposeNestedAfterWait = false;
      phase = 'nested-ready';
    }
  }
};

await __testing.expandMounted(runtimePage, 20);
assert.deepEqual(processed, ['parent', 'nested']);
assert.equal(expansionGeneration, 2);
assert.equal(quiescence.converged, true);
assert.equal(quiescence.rounds, 3);
assert.equal(quiescence.scopeTurnId, 'conversation-turn-54');
assert.ok(turnSamples >= 4, 'expected turn-scoped samples while nested content settled');
assert.equal(mountedWholeDomSamples, 0, 'whole-mounted-DOM stability must not control beta8 disclosure convergence');

// A viewport with no disclosure activity exits after two lightweight idle
// samples even if unrelated mounted DOM would be oscillating.
let idleSamples = 0;
globalThis.__archiveCrawler = {
  expandOne() { return null; },
  capture() { return {}; },
  mountedDisclosureSample() {
    idleSamples++;
    return { signature: '', actionableCollapsed: 0, recognizedCollapsed: 0, closedDetails: 0 };
  },
  markQuiescence() {},
  stats() { return {}; },
  metrics() { return { top: 0, height: 1000, client: 1000 }; }
};
await __testing.expandMounted(runtimePage, 20);
assert.equal(idleSamples, 2);

console.log('beta8 crawler install + retry reset + turn-scoped quiescence smoke test passed');

// Endpoint convergence must also ignore virtualizer membership churn. The
// durable retained/capture state is unchanged, but mountedFirst alternates on
// every stats read as turn 45 enters/leaves the live viewport.
let endpointIterations = 0;
let endpointStatsReads = 0;
globalThis.__archiveCrawler = {
  expandOne() { return null; },
  mountedDisclosureSample() {
    return { signature: '', actionableCollapsed: 0, recognizedCollapsed: 0, closedDetails: 0 };
  },
  capture() { endpointIterations++; return {}; },
  captureTurn() { return {}; },
  markQuiescence() {},
  metrics() { return { top: 0, height: 1000, client: 1000 }; },
  setTop() {},
  resetNavigation() {},
  navigateTop() {},
  stats() {
    endpointStatsReads++;
    return {
      turns: 60,
      expanded: 485,
      clicks: 485,
      failures: 0,
      preBlocks: 605,
      codeBlocks: 749,
      timelineMarkers: 3,
      oldestRetained: 'conversation-turn-1',
      newestRetained: 'conversation-turn-60',
      mountedFirst: endpointStatsReads % 2 ? 'conversation-turn-45' : 'conversation-turn-46',
      mountedLast: 'conversation-turn-60',
      allCollapsedControls: 0,
      recognizedCollapsed: 0,
      actionableCollapsed: 0,
      closedDetails: 0,
      expansionGeneration: 395,
      retainedUnresolvedTurns: 0,
      retainedUnresolvedDisclosures: 0
    };
  }
};
await __testing.scan(runtimePage, 'down', 1, undefined, undefined, 20);
assert.ok(endpointIterations <= 7, `endpoint should converge despite mounted-turn churn; captures=${endpointIterations}`);

console.log('beta8 endpoint stability ignores unrelated mounted-turn churn');
