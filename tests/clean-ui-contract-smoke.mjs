import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
for (const stale of ['Diagnostic validation', 'Waiting for you', 'diagnosticStep', 'diagnosticSteps', 'waitingForUser']) {
  assert.ok(!html.includes(stale), `clean UI still contains development-only state: ${stale}`);
}
assert.match(html, /preview\.html\?id=/, 'clean UI must launch preview with canonical id');
assert.match(html, /data\.id/, 'clean UI must consume canonical start-response id');
assert.doesNotMatch(html, /data\.jobId/, 'clean UI must not consume legacy jobId');

console.log('beta11 clean UI contract smoke test passed');
