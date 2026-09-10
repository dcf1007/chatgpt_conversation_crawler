import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA14_DEV.md', import.meta.url), 'utf8');
for (const required of [
  'v1.6.7-beta14-dev',
  '479 confirmed expansions',
  'conversation-turn-14',
  'Emulation.setFocusEmulationEnabled',
  'document.visibilityState',
  'no newer retained generation',
  'mounted turn window',
  'MHTML'
]) {
  assert.ok(doc.includes(required), `BETA14_DEV.md missing ${required}`);
}
console.log('beta14-dev diagnostic documentation smoke test passed');
