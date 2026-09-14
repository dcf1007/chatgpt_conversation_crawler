import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

const completionPatchIndex = source.indexOf('completionPatch = {');
const closingStateIndex = source.indexOf("phase: 'Closing browser session'", completionPatchIndex);
const browserCleanupIndex = source.indexOf('if (job.authenticatedHandle) await job.authenticatedHandle.close()', closingStateIndex);
const referencesClearedIndex = source.indexOf('job.page = null;', browserCleanupIndex);
const publishCompletionIndex = source.indexOf('update(job, { ...completionPatch, finishedAt: now() });', referencesClearedIndex);
const downloadGateIndex = source.indexOf("if (job.state !== 'complete' || !job.html)");

assert.ok(completionPatchIndex >= 0, 'final archive result should be staged as a pending completion patch');
assert.ok(closingStateIndex > completionPatchIndex, 'job should remain in finalization while cleanup is pending');
assert.ok(browserCleanupIndex > closingStateIndex, 'browser/session cleanup must happen after final archive assembly');
assert.ok(referencesClearedIndex > browserCleanupIndex, 'Playwright ownership references must be cleared after cleanup');
assert.ok(publishCompletionIndex > referencesClearedIndex,
  'state=complete and finishedAt must be published only after browser/diagnostic cleanup');
assert.ok(downloadGateIndex > publishCompletionIndex,
  'download route should continue to require the post-cleanup complete state');

const preCleanupSlice = source.slice(closingStateIndex, referencesClearedIndex);
assert.equal(preCleanupSlice.includes("state: 'complete'"), false,
  'cleanup window must not expose a complete state');

console.log('archive completion-after-cleanup lifecycle smoke test passed');
