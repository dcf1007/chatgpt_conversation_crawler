import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');
for (const field of [
  'visibilityState',
  'documentHidden',
  'documentHasFocus',
  'focusEmulation',
  'idleOverride',
  'lifecycleActive',
  'foregroundReassertions',
  'focusEventCount',
  'blurEventCount',
  'visibilityChangeCount',
  'navigationStagnantSteps',
  'navigationLogicalProgress',
  'navigationRequestedTop',
  'navigationAppliedTop',
  'navigationLeadingTurn',
  'navigationTrailingTurn',
  'navigationAmplifiedRequests',
  'navigationDirectionResets'
]) {
  assert.ok(source.includes(field), `MHTML manifest instrumentation missing ${field}`);
}
console.log('MHTML core navigation/activity metadata smoke test passed');
