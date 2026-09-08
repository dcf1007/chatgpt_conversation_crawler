import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const traversal = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');

for (const stage of ['queued','loading','preparing','traversal','oldest_verification','reconciliation','finalization','complete','error','cancelled']) {
  assert.ok(server.includes(stage) || traversal.includes(stage), `stage contract missing ${stage}`);
}
assert.match(server, /progressLimits/);
assert.match(index, /s\.stage/);
assert.doesNotMatch(index, /\/verifying oldest\/|\/reconcil/i, 'UI must not infer machine stage from phase wording');
assert.doesNotMatch(index, /oldestQuietChecks\s*\/\s*12|reconciliationRounds\s*\/\s*2/, 'UI must use backend progress limits');

console.log('beta11 explicit progress-stage smoke test passed');
