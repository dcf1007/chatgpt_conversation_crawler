import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.version, '1.7.1-beta-dev');
console.log('v1.7.1-beta-dev current version smoke test passed');
