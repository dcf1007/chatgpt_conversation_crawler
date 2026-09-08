import assert from 'node:assert/strict';
import fs from 'node:fs';

const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
assert.match(readme, /v1\.6\.7-beta11|beta11/i, 'README must identify beta11');
assert.doesNotMatch(readme, /clean `v1\.6\.7-beta10\.1` release/i, 'README must not present beta10.1 as current clean release');
assert.match(readme, /canonical.*id|archive identifier.*id/i, 'README should document the canonical id contract');

console.log('beta11 README version smoke test passed');
