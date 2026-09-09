import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA12_DEV.md', import.meta.url), 'utf8');
for (const required of ['v1.6.7-beta12-dev','mhtml-diagnostics','manual-inspection-diagnostics','Anonymous','Authenticated','browser-profile','uploaded-image sanitizer','reference-aware']) {
  assert.ok(doc.includes(required), `BETA12_DEV.md missing ${required}`);
}
console.log('beta12-dev diagnostic documentation smoke test passed');
