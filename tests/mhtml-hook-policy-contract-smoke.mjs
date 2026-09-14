import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/mhtml-dev-hook.mjs', import.meta.url), 'utf8');

assert.match(source, /recordTelemetry\('material-dom-change', currentSample/,
  'material DOM changes must be recorded as telemetry');
assert.match(source, /selectMhtmlCheckpointReason\(previousSample, currentSample\)/,
  'MHTML checkpoint selection must be independent from the broad telemetry signature');
assert.match(source, /captureRich\(checkpointReason/,
  'selected semantic transitions must still produce forensic MHTML');
assert.match(source, /recordTelemetry\('lazy-resource-loaded', resourceSample/,
  'resource completion events must default to JSONL telemetry');
assert.doesNotMatch(source, /captureRich\('material-dom-change'/,
  'raw material DOM changes must never directly invoke MHTML serialization');
assert.doesNotMatch(source, /captureRich\('lazy-resource-loaded'/,
  'raw resource completion must never directly invoke MHTML serialization');

const stopRecorderStart = source.indexOf('async function stopRecorder');
const closingSeal = source.indexOf('state.closing = true;', stopRecorderStart);
const finalCapture = source.indexOf('state.recorder.capture(reason', stopRecorderStart);
assert.ok(closingSeal > stopRecorderStart && closingSeal < finalCapture,
  'recorder hook must seal late callbacks before requesting the closing checkpoint');

console.log('MHTML hook telemetry/checkpoint contract smoke test passed');
