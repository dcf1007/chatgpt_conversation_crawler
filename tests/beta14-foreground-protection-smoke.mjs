import assert from 'node:assert/strict';
import {
  installPageForegroundProtection,
  pageForegroundProtectionInstalled
} from '../src/runtime-browser.mjs';

const calls = [];
let detached = 0;
const session = {
  async send(method, params) { calls.push({ method, params }); },
  async detach() { detached++; }
};
let marker = null;
global.window = {
  addEventListener() {}
};
global.document = {
  hidden: false,
  visibilityState: 'visible',
  hasFocus: () => false,
  addEventListener() {}
};
const page = {
  context() {
    return { async newCDPSession(target) { assert.equal(target, page); return session; } };
  },
  async evaluate(fn, arg) {
    const result = fn(arg);
    marker = global.window.__archiveForegroundProtection || marker;
    return result;
  }
};

assert.equal(await installPageForegroundProtection(page), true);
assert.deepEqual(calls, [{ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }]);
assert.equal(pageForegroundProtectionInstalled(page), true);
assert.equal(marker?.focusEmulation, true);
assert.equal(marker?.preInstallHasFocus, false);
assert.equal(marker?.preInstallVisibilityState, 'visible');
assert.equal(await installPageForegroundProtection(page), false, 'foreground protection must be idempotent per page');
assert.equal(calls.length, 1);
assert.equal(detached, 0);
assert.ok(global.window.__archiveFocusTelemetry, 'focus/visibility event telemetry must be installed before emulation');

console.log('beta14 page foreground protection smoke test passed');
