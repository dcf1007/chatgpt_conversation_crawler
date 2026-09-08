import assert from 'node:assert/strict';
import fs from 'node:fs';
const marker = fs.readFileSync(new URL('../DIAGNOSTIC_BUILD_ONLY', import.meta.url), 'utf8');
assert.match(marker, /diagnostic-only/i);
assert.match(marker, /must not be merged/i);
console.log('beta11-dev diagnostic-only marker smoke test passed');
