import assert from 'node:assert/strict';
import {
  ensurePageForegroundProtection,
  installPageForegroundProtection,
  pageForegroundProtectionInstalled
} from '../src/runtime-browser.mjs';

const calls = [];
let detached = 0;
let stale = false;
let createdSessions = 0;

function makeSession(name) {
  return {
    async send(method, params) {
      calls.push({ name, method, params });
      if (name === 'session-1' && stale) throw new Error('Target closed');
    },
    async detach() { detached++; }
  };
}

const sessions = [makeSession('session-1'), makeSession('session-2')];
global.window = { addEventListener() {} };
global.document = {
  hidden: false,
  visibilityState: 'visible',
  hasFocus: () => false,
  addEventListener() {}
};
const page = {
  context() {
    return {
      async newCDPSession(target) {
        assert.equal(target, page);
        return sessions[createdSessions++];
      }
    };
  },
  async evaluate(fn, arg) { return fn(arg); }
};

assert.equal(await installPageForegroundProtection(page), true);
assert.equal(createdSessions, 1);
assert.deepEqual(calls.map(({ method, params }) => ({ method, params })), [
  { method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } },
  { method: 'Emulation.setIdleOverride', params: { isUserActive: true, isScreenUnlocked: true } },
  { method: 'Page.setWebLifecycleState', params: { state: 'active' } }
]);
assert.ok(!calls.some(call => call.method === 'Page.bringToFront'));
assert.equal(pageForegroundProtectionInstalled(page), true);
assert.equal(global.window.__archiveForegroundProtection.pageActivated, false);
assert.equal(await installPageForegroundProtection(page), false, 'installer must remain idempotent per page');

assert.equal(await ensurePageForegroundProtection(page), true);
assert.equal(createdSessions, 1, 'healthy reassertion must reuse the cached session');
assert.equal(global.window.__archiveForegroundProtection.reassertions, 1);

stale = true;
assert.equal(await ensurePageForegroundProtection(page), true, 'stale session must be recreated once');
assert.equal(createdSessions, 2);
assert.equal(detached, 1, 'stale cached session should be detached before replacement');
assert.equal(global.window.__archiveForegroundProtection.sessionRecoveries, 1);
assert.equal(global.window.__archiveForegroundProtection.reassertions, 2);
assert.ok(!calls.some(call => call.method === 'Page.bringToFront'), 'recovery must never activate the native browser window');
assert.equal(pageForegroundProtectionInstalled(page), true);
assert.ok(global.window.__archiveFocusTelemetry);

console.log('v1.7 beta2 non-activating page foreground recovery smoke test passed');
