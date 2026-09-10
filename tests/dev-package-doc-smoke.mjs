import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA14_3_DEV.md', import.meta.url), 'utf8');
for (const required of [
  'v1.6.7-beta14.3-dev',
  'leading edge of the active virtualized viewport',
  'reversing direction starts a new baseline',
  'crawler.setTop(value)',
  'crawler.navigateTop(value)',
  'automatic traversal',
  'Emulation.setIdleOverride',
  'Page.setWebLifecycleState',
  'Page.bringToFront',
  'is no longer used',
  'permanent crawler core',
  'MHTML'
]) {
  assert.ok(doc.includes(required), `BETA14_3_DEV.md missing ${required}`);
}
console.log('beta14.3-dev diagnostic documentation smoke test passed');
