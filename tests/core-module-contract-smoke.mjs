import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../src/crawler-core.mjs', import.meta.url), 'utf8');
const expansion = fs.readFileSync(new URL('../src/crawler-expansion.mjs', import.meta.url), 'utf8');
const traversal = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

assert.match(core, /installMountRetention/);
assert.match(core, /installDisclosureState/);
assert.match(core, /flushMountRetention/);
assert.match(server, /installTransientContextRetention/);
assert.match(server, /flushTransientContextRetention/);
assert.match(expansion, /turnDisclosureSample/);
assert.match(expansion, /mountedDisclosureSample/);
assert.match(traversal, /verifyOldestMessages/);
assert.match(traversal, /reconcileRetainedDisclosures/);

console.log('beta11 core/runtime module contract smoke test passed');
