import assert from 'node:assert/strict';
import {
  CHROMIUM_BACKGROUND_PROTECTION_ARGS,
  installChromiumBackgroundProtection,
  withChromiumBackgroundProtection
} from '../src/chromium-background-protection.mjs';

const original = {
  headless: false,
  viewport: { width: 1440, height: 1000 },
  args: ['--existing-flag', '--disable-renderer-backgrounding']
};
const protectedOptions = withChromiumBackgroundProtection(original);

assert.notStrictEqual(protectedOptions, original);
assert.deepEqual(protectedOptions.viewport, original.viewport);
assert.ok(protectedOptions.args.includes('--existing-flag'));
for (const flag of CHROMIUM_BACKGROUND_PROTECTION_ARGS) {
  assert.equal(protectedOptions.args.filter(value => value === flag).length, 1, `${flag} should be present exactly once`);
}
assert.deepEqual(original.args, ['--existing-flag', '--disable-renderer-backgrounding'], 'input options must not be mutated');

const calls = [];
const prototype = {
  launchPersistentContext(userDataDir, options) {
    calls.push({ userDataDir, options });
    return Promise.resolve({ userDataDir, options });
  }
};
const fakeChromium = Object.create(prototype);
assert.equal(installChromiumBackgroundProtection(fakeChromium), true);
assert.equal(installChromiumBackgroundProtection(fakeChromium), false, 'install should be idempotent');

await fakeChromium.launchPersistentContext('/tmp/profile', { headless: false, args: ['--existing'] });
assert.equal(calls.length, 1);
for (const flag of CHROMIUM_BACKGROUND_PROTECTION_ARGS) {
  assert.ok(calls[0].options.args.includes(flag), `${flag} should protect headed persistent Chromium`);
}
assert.ok(calls[0].options.args.includes('--existing'));

await fakeChromium.launchPersistentContext('/tmp/profile', { headless: true, args: ['--headless-existing'] });
assert.deepEqual(calls[1].options.args, ['--headless-existing'], 'headless persistent contexts should remain unchanged');

console.log('chromium background protection smoke test passed');
