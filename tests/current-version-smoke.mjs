import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.version, '1.6.7-beta13.1-dev');
console.log('beta13.1-dev current version smoke test passed');
