import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
assert.match(server, /job\.previewHtml\s*=\s*snapshot\.html/, 'completed archive must retain final preview HTML');
assert.match(server, /job\.html\s*=\s*snapshot\.html/, 'completed archive must retain final downloadable HTML');
assert.match(server, /previewReady:\s*Boolean\(job\.previewHtml\)/, 'status must expose preview readiness from retained preview HTML');

console.log('beta11 final preview retention smoke test passed');
