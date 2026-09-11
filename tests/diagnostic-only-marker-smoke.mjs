import assert from 'node:assert/strict';
import fs from 'node:fs';
const marker = fs.readFileSync(new URL('../DIAGNOSTIC_BUILD_ONLY', import.meta.url), 'utf8');
assert.match(marker, /v1\.7\.1-beta2\.1-dev/);
assert.match(marker, /diagnostic-only/i);
assert.match(marker, /must not be merged/i);
console.log('v1.7.1 beta2.1 dev diagnostic-only marker smoke test passed');
