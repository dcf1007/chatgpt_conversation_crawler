import assert from 'node:assert/strict';
import fs from 'node:fs';

const files = ['public/index.html','public/preview.html','server.mjs'].map(file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
assert.ok(!files.includes('preview.html?job='));
assert.ok(!/params\.get\(['"]job['"]\)/.test(files));

console.log('beta11 no legacy preview parameter smoke test passed');
