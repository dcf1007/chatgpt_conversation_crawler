import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');
for (const field of [
  'visibilityState',
  'documentHidden',
  'documentHasFocus',
  'focusEmulation',
  'focusEventCount',
  'blurEventCount',
  'visibilityChangeCount',
  'manualScrollStagnantSteps',
  'manualScrollRequestedTop',
  'manualScrollAppliedTop'
]) {
  assert.ok(source.includes(field), `MHTML manifest instrumentation missing ${field}`);
}
console.log('beta14 MHTML focus/visibility metadata smoke test passed');
