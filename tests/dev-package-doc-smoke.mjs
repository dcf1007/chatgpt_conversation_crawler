import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA13_1_DEV.md', import.meta.url), 'utf8');
for (const required of ['v1.6.7-beta13.1-dev','turn 62','turn 64','page-side','per turn','logical disclosure','MHTML','beta13']) {
  assert.ok(doc.includes(required), `BETA13_1_DEV.md missing ${required}`);
}
console.log('beta13.1-dev diagnostic documentation smoke test passed');
