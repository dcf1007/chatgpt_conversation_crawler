import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.scripts.start,'node server.mjs');
console.log('beta11 clean entrypoint smoke test passed');
