import assert from 'node:assert/strict';
import fs from 'node:fs';
const p=fs.readFileSync(new URL('../public/preview.html',import.meta.url),'utf8');
assert.match(p,/\/api\/archive\/status\/\$\{encodeURIComponent\(id\)\}\?preview=1/);
assert.match(p,/\/api\/archive\/preview\/\$\{encodeURIComponent\(id\)\}/);
console.log('beta11 preview route contract smoke test passed');
