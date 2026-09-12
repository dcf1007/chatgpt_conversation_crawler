import assert from 'node:assert/strict';
import fs from 'node:fs';

const crawler = fs.readFileSync(new URL('../src/crawler.mjs', import.meta.url), 'utf8');
const hook = fs.readFileSync(new URL('../src/mhtml-dev-hook.mjs', import.meta.url), 'utf8');
const metadata = fs.readFileSync(new URL('../src/mhtml-manifest-metadata.mjs', import.meta.url), 'utf8');
const recorder = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');

assert.match(crawler, /__archiveDiagnosticProgress/, 'development crawler facade must publish real crawler progress for diagnostics');
for (const field of ['phase', 'pass', 'direction', 'step', 'stage']) {
  assert.match(hook, new RegExp(`progressState\\.${field}`), `MHTML sampling must read crawler ${field}`);
}
assert.match(hook, /mountedTurns:\s*sections\.length/, 'diagnostics must identify mounted DOM turn count explicitly');
assert.match(hook, /retainedTurns:\s*Number\(crawlerStats\.turns/, 'diagnostics must identify retained turn count explicitly');
assert.match(hook, /diagnosticSampleSignature\(currentSample\)/, 'development hook must use the shared diagnostic material signature');
assert.match(metadata, /scrollTop:\s*Math\.round\(Number\(sample\.scrollTop\s*\|\|\s*0\)\)/, 'scrollTop must participate in the material signature');
assert.match(metadata, /scrollClient:\s*Math\.round\(Number\(sample\.scrollClient\s*\|\|\s*0\)\)/, 'scroll client height must participate in the material signature');
assert.match(metadata, /scrollHeight:\s*Math\.round\(Number\(sample\.scrollHeight\s*\|\|\s*0\)\)/, 'scroll height must participate in the material signature');
assert.match(recorder, /mountedTurns:\s*diagnosticState\.mountedTurns/, 'manifest must record mountedTurns');
assert.match(recorder, /retainedTurns:\s*diagnosticState\.retainedTurns/, 'manifest must record retainedTurns');
assert.doesNotMatch(recorder, /\bturns:\s*diagnosticState\.turns/, 'manifest must not keep the ambiguous diagnostic turns field');

console.log('v1.7 beta3 diagnostic truthfulness smoke test passed');
