import assert from 'node:assert/strict';
import fs from 'node:fs';
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.equal(pkg.scripts.start,'node server-dev.mjs');
assert.ok(fs.existsSync(new URL('../server-dev.mjs',import.meta.url)));
assert.ok(fs.existsSync(new URL('../server.mjs',import.meta.url)));
console.log('beta11-dev diagnostic entrypoint smoke test passed');
