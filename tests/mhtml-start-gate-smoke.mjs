import assert from 'node:assert/strict';
import { createAsyncStartGate } from '../src/mhtml-start-gate.mjs';

const runStart = createAsyncStartGate();
const pageKey = {};
let starts = 0;
let releaseStart;
const startBarrier = new Promise(resolve => { releaseStart = resolve; });

const startOperation = async () => {
  starts++;
  await startBarrier;
  return 'started';
};

const first = runStart(pageKey, startOperation);
const second = runStart(pageKey, startOperation);
await Promise.resolve();
assert.equal(starts, 1, 'concurrent load events must share one recorder start');
releaseStart();
assert.equal(await first, 'started');
assert.equal(await second, 'started');
assert.equal(starts, 1);

await runStart(pageKey, async () => { starts++; return 'retry'; });
assert.equal(starts, 2, 'the gate only deduplicates concurrent starts; pageState owns completion');

console.log('MHTML recorder start-gate smoke test passed');
