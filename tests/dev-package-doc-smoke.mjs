import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA14_1_DEV.md', import.meta.url), 'utf8');
for (const required of [
  'v1.6.7-beta14.1-dev',
  '678 confirmed expansions',
  'conversation-turn-14',
  'conversation-turn-120',
  'leading/minimum mounted turn',
  'misclassified as stagnation',
  'automatic traversal',
  'MHTML'
]) {
  assert.ok(doc.includes(required), `BETA14_1_DEV.md missing ${required}`);
}
console.log('beta14.1-dev diagnostic documentation smoke test passed');
