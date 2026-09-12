import assert from 'node:assert/strict';
import fs from 'node:fs';

const crawler = fs.readFileSync(new URL('../src/crawler.mjs', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('../src/mhtml-dev-hook.mjs', import.meta.url), 'utf8');
const metadata = fs.readFileSync(new URL('../src/mhtml-manifest-metadata.mjs', import.meta.url), 'utf8');
const recorder = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');

assert.match(crawler, /__archiveDiagnosticProgress/, 'development crawler facade must publish real crawler progress for diagnostics');
assert.match(crawler, /archive-crawler-diagnostic-progress/, 'crawler progress must emit an event for event-driven diagnostics');
for (const field of ['phase', 'pass', 'direction', 'step', 'stage']) {
  assert.match(hook, new RegExp(`progressState\\.${field}`), `MHTML sampling must read crawler ${field}`);
}
assert.doesNotMatch(hook, /SAMPLE_INTERVAL_MS/, 'dev2.1 must not restore a fixed one-second sample interval');
assert.doesNotMatch(hook, /setInterval\s*\(/, 'dev2.1 diagnostics must be event-driven, not interval-polled');
assert.match(hook, /MutationObserver/, 'relevant DOM mutations must wake the diagnostic recorder');
assert.match(hook, /archive-crawler-diagnostic-progress/, 'crawler progress events must wake the diagnostic recorder');
assert.match(hook, /samplePage\(page, \{ rich: false \}\)/, 'events must use a lightweight material sample');
assert.match(hook, /samplePage\(page, \{ rich: true \}\)/, 'actual captures must collect rich forensic state');
assert.match(hook, /recorder\.noteActivity\(\)/, 'all diagnostic activity must postpone the 10-second idle snapshot');
assert.match(hook, /document\.body\?\.textContent/, 'text-length sampling must avoid innerText forced layout');
assert.match(hook, /candidateDisclosureIds/, 'deep disclosure inspection must be limited to closed-disclosure candidates');
assert.match(hook, /mountedTurns:\s*sections\.length/, 'diagnostics must identify mounted DOM turn count explicitly');
assert.match(metadata, /scrollTop:\s*Math\.round\(Number\(sample\.scrollTop\s*\|\|\s*0\)\)/, 'scrollTop must remain in the material signature');
assert.match(metadata, /scrollClient:\s*Math\.round\(Number\(sample\.scrollClient\s*\|\|\s*0\)\)/, 'scroll client height must remain in the material signature');
assert.match(metadata, /scrollHeight:\s*Math\.round\(Number\(sample\.scrollHeight\s*\|\|\s*0\)\)/, 'scroll height must remain in the material signature');
assert.match(metadata, /textLength:\s*Number\(sample\.textLength\s*\|\|\s*0\)/, 'beta3 material text sensitivity must remain present');
assert.match(recorder, /mountedTurns:\s*diagnosticState\.mountedTurns/, 'manifest must record mountedTurns');
assert.match(recorder, /retainedTurns:\s*diagnosticState\.retainedTurns/, 'manifest must record retainedTurns');
assert.match(recorder, /function noteActivity\(\)/, 'recorder must expose event activity to the idle scheduler');
assert.doesNotMatch(recorder, /createHash|sha256/i, 'dev2.1 must not hash complete MHTML snapshots');
assert.doesNotMatch(recorder, /\bturns:\s*diagnosticState\.turns/, 'manifest must not keep the ambiguous diagnostic turns field');

console.log('v1.7 beta3-dev2.1 event-driven diagnostic smoke test passed');
