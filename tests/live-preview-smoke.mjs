import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const previewHtml = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

assert.match(indexHtml, /preview\.html\?id=\$\{encodeURIComponent\(currentArchiveId\)\}/, 'main UI must launch preview with canonical id');
assert.doesNotMatch(indexHtml, /\?job=|jobId/, 'main UI must not use legacy job/jobId identifiers');
assert.match(previewHtml, /params\.get\('id'\)/, 'preview page must read canonical id');
assert.doesNotMatch(previewHtml, /params\.get\('job'\)|\?job=/, 'preview page must reject legacy job query naming');
assert.match(previewHtml, /\/api\/archive\/status\/\$\{encodeURIComponent\(id\)\}\?preview=1/);
assert.match(previewHtml, /\/api\/archive\/preview\/\$\{encodeURIComponent\(id\)\}/);
assert.match(server, /response\.status\(202\)\.json\(\{ id \}\)/, 'start endpoint must return { id }');
assert.doesNotMatch(server, /jobId/, 'server contract must not expose jobId');

console.log('beta11 canonical archive id + live preview contract smoke test passed');
