import assert from 'node:assert/strict';
import { installManualScrollAssist, restoreManualScrollAssist } from '../src/manual-scroll-assist.mjs';

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;

let top = 1000;
let mountedIds = ['conversation-turn-2', 'conversation-turn-120'];
const applied = [];
const crawler = {
  metrics() {
    return { top, height: 100_000, client: 1000 };
  },
  setTop(value) {
    top = Number(value);
    applied.push(top);
    return top;
  }
};

globalThis.window = { __archiveCrawler: crawler };
globalThis.document = {
  querySelectorAll() {
    return mountedIds.map(id => ({ getAttribute: name => name === 'data-testid' ? id : null }));
  }
};

const page = {
  async evaluate(fn, arg) {
    return fn(arg);
  }
};

try {
  assert.equal(await installManualScrollAssist(page), true);

  // First downward request establishes the directional baseline.
  crawler.setTop(1400);
  assert.equal(applied.at(-1), 1400);
  assert.equal(window.__archiveManualScrollAssist.lastLogicalProgress, true);
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 0);

  // Exact beta14 regression shape: the newest turn remains mounted while the
  // leading edge advances. That must count as genuine forward progress and must
  // not amplify the caller's requested displacement.
  mountedIds = ['conversation-turn-4', 'conversation-turn-120'];
  crawler.setTop(1800);
  assert.equal(applied.at(-1), 1800, 'pinned newest turn must not cause false forward stagnation');
  assert.equal(window.__archiveManualScrollAssist.lastLogicalProgress, true);
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 0);

  // Amplification is retained for the real beta13.1 failure mode: the leading
  // edge does not move after repeated same-direction requests.
  crawler.setTop(2200);
  assert.equal(applied.at(-1), 2200);
  assert.equal(window.__archiveManualScrollAssist.lastLogicalProgress, false);
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 1);

  crawler.setTop(2600);
  assert.ok(applied.at(-1) > 2600, 'true leading-edge stagnation should amplify the second repeated request');
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 2);

  // A corrective reversal must start a new directional run. Returning forward
  // afterwards must not inherit the previous run's all-time high-water mark;
  // otherwise the down/back-up/down loop can recreate false stagnation.
  mountedIds = ['conversation-turn-2', 'conversation-turn-120'];
  crawler.setTop(1200);
  assert.equal(applied.at(-1), 1200);
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 0);

  mountedIds = ['conversation-turn-4', 'conversation-turn-120'];
  crawler.setTop(1600);
  assert.equal(applied.at(-1), 1600, 'direction reversal must reset the forward leading-edge baseline');
  assert.equal(window.__archiveManualScrollAssist.lastLogicalProgress, true);
  assert.equal(window.__archiveManualScrollAssist.stagnantSteps, 0);

  assert.equal(await restoreManualScrollAssist(page), true);
  assert.equal(window.__archiveManualScrollAssist.active, false);
} finally {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}

console.log('beta14.1 pinned-newest and direction-reset navigation regression smoke test passed');
