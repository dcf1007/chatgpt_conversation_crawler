import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

for (const label of ['Current action', 'Coverage', 'Position in loaded content', 'Worker heartbeat:', 'Last substantive progress:']) {
  assert.ok(html.includes(label), `missing visible UI label: ${label}`);
}
assert.ok(!html.includes('>Mounted first<'), 'mounted frontier should not be a primary UI field');
assert.ok(!html.includes('>Scanning<'), 'duplicated scanning row should be removed');
assert.ok(!html.includes('Technical details'), 'no collapsed technical-details section requested');
assert.ok(html.includes('Diagnostic validation'));
assert.ok(html.includes('Waiting for you'));
assert.ok(html.includes('Progress bars are local to the current stage'));

assert.ok(server.includes('seenMountedTurns'));
assert.ok(server.includes('seenMountedUnretainedTurns'));
assert.ok(server.includes('positionInLoadedContent'));
const materialBody = server.split('function materialSignature')[1].split('function previewSignature')[0];
assert.ok(!materialBody.includes('mountedFirst'), 'mounted frontier must not reset substantive progress');
assert.ok(!materialBody.includes('mountedLast'), 'mounted frontier must not reset substantive progress');
assert.ok(!materialBody.includes('maxObservedScrollHeight'), 'scroll-height churn must not reset substantive progress');

console.log('beta10 stage-local status UI and substantive-progress smoke test passed');
