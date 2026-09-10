import assert from 'node:assert/strict';
import {
  ensurePageForegroundProtection,
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
assert.deepEqual(calls, [
  { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
  { method: 'Emulation.setIdleOverride', params: { isUserActive: true, isScreenUnlocked: true } },
  { method: 'Page.setWebLifecycleState', params: { state: 'active' } },
  { method: 'Page.bringToFront', params: undefined }
]);
assert.equal(pageForegroundProtectionInstalled(page), true);
assert.equal(marker?.focusEmulation, true);
assert.equal(marker?.idleOverride, true);
assert.equal(marker?.lifecycleActive, true);
assert.equal(marker?.pageActivated, true);
assert.equal(marker?.preInstallHasFocus, false);
assert.equal(marker?.preInstallVisibilityState, 'visible');
assert.equal(await installPageForegroundProtection(page), false, 'installer must remain idempotent per page');
assert.equal(calls.length, 4, 'idempotent install must not silently create another CDP session');

assert.equal(await ensurePageForegroundProtection(page), true);
assert.equal(calls.length, 8, 'reassertion must replay the complete active-page state');
assert.equal(global.window.__archiveForegroundProtection.reassertions, 1);
assert.ok(global.window.__archiveForegroundProtection.lastReassertedAt);
assert.equal(detached, 0);
assert.ok(global.window.__archiveFocusTelemetry, 'focus/visibility event telemetry must be installed before emulation');

console.log('beta14.2 permanent page foreground protection smoke test passed');
