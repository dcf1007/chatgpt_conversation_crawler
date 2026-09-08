import assert from 'node:assert/strict';
import fs from 'node:fs';

const preview = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');
assert.match(preview, /missing archive id/i, 'preview without canonical id should show a useful error');
assert.doesNotMatch(preview, /missing archive job id/i, 'preview wording should not preserve legacy job terminology');

console.log('beta11 preview missing-id smoke test passed');
