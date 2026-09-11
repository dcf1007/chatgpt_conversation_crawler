import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');

assert.match(server, /response\.status\(202\)\.json\(\{\s*id\s*\}\)/, 'start endpoint must return only canonical id');
assert.doesNotMatch(server, /jobId/);
assert.match(index, /currentJobId\s*=\s*data\.id|currentArchiveId\s*=\s*data\.id/);
assert.doesNotMatch(index, /data\.jobId/);
assert.match(index, /preview\.html\?id=/);
assert.match(preview, /params\.get\(['"]id['"]\)/);
assert.doesNotMatch(preview, /params\.get\(['"]job['"]\)/);
assert.match(preview, /\/api\/archive\/status\/\$\{encodeURIComponent\(id\)\}\?preview=1/);
assert.match(preview, /\/api\/archive\/preview\/\$\{encodeURIComponent\(id\)\}/);

console.log('canonical identifier smoke test passed');
