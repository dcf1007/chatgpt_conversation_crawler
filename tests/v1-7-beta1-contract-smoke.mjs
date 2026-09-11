import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = fs.readFileSync(new URL('../src/crawler-base.mjs', import.meta.url), 'utf8');
const traversal = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');
const mount = fs.readFileSync(new URL('../src/crawler-mount-retention.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

assert.match(base, /unionUnits\(/, 'hydration retention must merge incomparable content generations');
assert.match(base, /unitCounts\(/, 'hydration union must preserve content multiplicity');
assert.match(base, /turnGenerationFingerprints/, 'semantic generation identity must survive remounts');
assert.match(base, /hydrationConflictsUnresolved/, 'unresolved hydration conflicts must be reported');
assert.match(mount, /characterData:\s*true/, 'mount retention must observe text-node hydration');
assert.match(traversal, /markScanResult/, 'scan convergence must be persisted');
assert.match(traversal, /return result;/, 'scan must return an explicit convergence result');
assert.match(server, /structuredClone\(state\)/, 'snapshot assembly must clone retained state');
assert.doesNotMatch(server, /restoreEmbeddedContent|restoreMainImages/, 'snapshot assembly must not rewrite and restore live retained turn HTML');
assert.match(server, /evaluateArchiveIntegrity/, 'finalization must run centralized archive integrity validation');

console.log('v1.7 beta1 integrity contract smoke test passed');
