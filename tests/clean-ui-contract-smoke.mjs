import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /Diagnostic validation|Waiting for you/i, 'clean UI must not expose development diagnostic prompts');
assert.match(html, /preview\.html\?id=/, 'clean UI must launch preview with canonical id');
assert.match(html, /data\.id/, 'clean UI must consume canonical start-response id');
assert.doesNotMatch(html, /data\.jobId/, 'clean UI must not consume legacy jobId');
assert.match(html, /integrityWarningCount/, 'clean UI must surface final crawler integrity warnings');
assert.match(html, /Complete with integrity warnings/, 'clean UI must distinguish warning completion from verified completion');

console.log('clean UI contract smoke test passed');
