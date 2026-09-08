import assert from 'node:assert/strict';
import fs from 'node:fs';
for (const file of ['server-dev.mjs','src/mhtml-dev-hook.mjs','src/manual-inspection.mjs']) assert.ok(!fs.existsSync(new URL(`../${file}`, import.meta.url)));
console.log('beta11 no development runtime smoke test passed');
