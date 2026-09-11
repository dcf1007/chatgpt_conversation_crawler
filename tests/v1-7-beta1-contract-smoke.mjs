import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = fs.readFileSync(new URL('../src/crawler-base.mjs', import.meta.url), 'utf8');
const traversal = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');
const disclosure = fs.readFileSync(new URL('../src/crawler-disclosure-state.mjs', import.meta.url), 'utf8');
const mount = fs.readFileSync(new URL('../src/crawler-mount-retention.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const manual = fs.readFileSync(new URL('../src/manual-inspection.mjs', import.meta.url), 'utf8');
const images = fs.readFileSync(new URL('../src/main-images.mjs', import.meta.url), 'utf8');
const appBlocks = fs.readFileSync(new URL('../src/app-blocks.mjs', import.meta.url), 'utf8');
const snapshot = fs.readFileSync(new URL('../src/snapshot.mjs', import.meta.url), 'utf8');

assert.match(base, /unionUnits\(/, 'hydration retention must merge incomparable content generations');
assert.match(base, /unitCounts\(/, 'hydration union must preserve content multiplicity');
assert.match(base, /turnGenerationFingerprints/, 'semantic generation identity must survive remounts');
assert.match(base, /hydrationConflictsUnresolved/, 'unresolved hydration conflicts must be reported');
assert.match(mount, /characterData:\s*true/, 'mount retention must observe text-node hydration');
assert.match(traversal, /markScanResult/, 'scan convergence must be persisted');
assert.match(traversal, /return result;/, 'scan must return an explicit convergence result');
assert.match(disclosure, /turnRevision\(turn\.id\)/, 'retained convergence fingerprints must include semantic turn revisions');
assert.match(snapshot, /structuredClone\(state\)/, 'snapshot assembly must clone retained state through one shared helper');
assert.match(server, /captureArchiveState\(page\)/, 'normal snapshot assembly must use the detached-state helper');
assert.match(manual, /captureArchiveState\(page\)/, 'manual diagnostic snapshots must use the same detached-state helper');
for (const [name, source] of [['server', server], ['manual inspection', manual], ['main images', images], ['app blocks', appBlocks]]) {
  assert.doesNotMatch(source, /restoreEmbeddedContent|restoreMainImages|usingCopy/, `${name} must not retain the old live-state rewrite/restore path`);
}
assert.match(images, /requires a detached archiveState/, 'main-image preparation must have one detached-state contract');
assert.match(appBlocks, /requires a detached archiveState/, 'embedded-content preparation must have one detached-state contract');
assert.match(snapshot, /buildSnapshot requires a detached archiveState/, 'snapshot construction must have one detached-state contract');
assert.doesNotMatch(snapshot, /function\s+embedImages\b|__ARCHIVE_IMAGE_DIAGNOSTICS__/, 'snapshot must not retain a second generic image-finalization path');
assert.match(server, /prepareMainImages\(page, archiveState\)/, 'main-images must be the single final image preparation authority');
assert.match(server, /evaluateArchiveIntegrity/, 'finalization must run centralized archive integrity validation');

console.log('v1.7 beta1 integrity contract smoke test passed');
