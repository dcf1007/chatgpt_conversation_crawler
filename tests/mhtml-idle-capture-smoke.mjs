import assert from 'node:assert/strict';
import { createIdlePeriodicScheduler } from '../src/mhtml-recorder.mjs';

let nextId = 1;
let idleCaptures = 0;
const timers = new Map();

function setTimer(callback, delay) {
  const handle = {
    id: nextId++,
    unref() {}
  };
  timers.set(handle.id, { handle, callback, delay });
  return handle;
}

function clearTimer(handle) {
  if (handle) timers.delete(handle.id);
}

function onlyTimer() {
  assert.equal(timers.size, 1, 'expected exactly one idle timer');
  return [...timers.values()][0];
}

function fireTimer(handle) {
  const entry = timers.get(handle.id);
  assert.ok(entry, `timer ${handle.id} should still be active`);
  timers.delete(handle.id); // native setTimeout is one-shot
  entry.callback();
}

const scheduler = createIdlePeriodicScheduler(() => {
  idleCaptures++;
}, {
  intervalMs: 10_000,
  setTimer,
  clearTimer
});

assert.equal(scheduler.start(), true);
assert.equal(scheduler.start(), false, 'scheduler should start only once');
const initial = onlyTimer();
assert.equal(initial.delay, 10_000);

scheduler.noteActivity();
assert.equal(timers.has(initial.handle.id), false, 'event activity must postpone the prior idle timer');
const afterActivity = onlyTimer();
assert.notEqual(afterActivity.handle.id, initial.handle.id);
assert.equal(idleCaptures, 0);

fireTimer(afterActivity.handle);
assert.equal(idleCaptures, 1, 'an idle interval should emit one periodic capture');
const afterIdleCapture = onlyTimer();
assert.notEqual(afterIdleCapture.handle.id, afterActivity.handle.id, 'idle capture should arm the next safety interval');

scheduler.noteActivity();
assert.equal(timers.has(afterIdleCapture.handle.id), false, 'new event activity must postpone the next periodic capture too');
onlyTimer();

scheduler.stop();
assert.equal(timers.size, 0, 'stop should clear the active idle timer');
scheduler.noteActivity();
assert.equal(timers.size, 0, 'stopped scheduler must not rearm');

console.log('MHTML idle-periodic scheduler smoke test passed');
