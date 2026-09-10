import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA14_2_DEV.md', import.meta.url), 'utf8');
for (const required of [
  'v1.6.7-beta14.2-dev',
  'leading edge of the active virtualized viewport',
  'reversing direction starts a new baseline',
  'automatic traversal',
  'Emulation.setIdleOverride',
  'Page.setWebLifecycleState',
  'Page.bringToFront',
  'permanent crawler core',
  'MHTML'
]) {
  assert.ok(doc.includes(required), `BETA14_2_DEV.md missing ${required}`);
}
console.log('beta14.2-dev diagnostic documentation smoke test passed');
