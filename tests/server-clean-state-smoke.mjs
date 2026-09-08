import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
for (const stale of ['diagnosticStep','diagnosticSteps','waitingForUser','CHATGPT_CRAWLER_MANUAL_INSPECTION','mhtml']) {
  assert.ok(!server.includes(stale), `clean server contains development-only state/reference: ${stale}`);
}
assert.match(server, /stage:/, 'clean server must carry explicit stage state');

console.log('beta11 clean server state smoke test passed');
