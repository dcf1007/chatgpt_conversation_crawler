import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const preview = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');
assert.ok(!/\bjobId\b/.test(index));
assert.ok(!/\bjobId\b/.test(preview));

console.log('beta11 identifier naming smoke test passed');
