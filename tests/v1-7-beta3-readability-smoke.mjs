import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const file of [
  'src/crawler-base.mjs',
  'src/snapshot.mjs',
  'public/index.html',
  'public/preview.html'
]) {
  const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const longest = Math.max(...text.split(/\r?\n/).map(line => line.length));
  assert.ok(longest <= 320, `${file} still contains a compressed maintained line (${longest} chars)`);
}

console.log('v1.7 beta3 maintained-source readability smoke test passed');
