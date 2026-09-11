import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const file of [
  'server-dev.mjs',
  'src/mhtml-dev-hook.mjs',
  'src/mhtml-recorder.mjs',
  'src/mhtml-start-gate.mjs',
  'src/manual-inspection.mjs'
]) assert.ok(fs.existsSync(new URL(`../${file}`, import.meta.url)), `diagnostic runtime missing ${file}`);
console.log('isolated diagnostic runtime smoke test passed');
