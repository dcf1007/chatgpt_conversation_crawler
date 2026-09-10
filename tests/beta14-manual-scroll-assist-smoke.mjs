import assert from 'node:assert/strict';
import { assistedManualScrollTarget } from '../src/manual-scroll-assist.mjs';

const base = {
  currentTop: 1000,
  requestedTop: 1400,
  maximumTop: 20_000,
  client: 1000
};

assert.equal(
  assistedManualScrollTarget({ ...base, stagnantSteps: 0 }),
  1400,
  'normal mounted-window progress must preserve the caller scroll request'
);

const amplified = assistedManualScrollTarget({ ...base, stagnantSteps: 2 });
assert.ok(amplified >= 2500, `stagnant forward navigation should force a materially larger jump, got ${amplified}`);

const reverse = assistedManualScrollTarget({
  currentTop: 10_000,
  requestedTop: 9600,
  maximumTop: 20_000,
  client: 1000,
  stagnantSteps: 3
});
assert.ok(reverse <= 7750, `stagnant reverse navigation should also amplify, got ${reverse}`);

assert.equal(
  assistedManualScrollTarget({ currentTop: 19_500, requestedTop: 20_000, maximumTop: 20_000, client: 1000, stagnantSteps: 8 }),
  20_000,
  'assisted jumps must clamp to the real scroll range'
);

console.log('beta14 manual virtualizer scroll assist smoke test passed');
