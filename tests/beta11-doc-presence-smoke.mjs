import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.ok(fs.existsSync(new URL('../BETA11.md', import.meta.url)));
console.log('beta11 release notes presence smoke test passed');
