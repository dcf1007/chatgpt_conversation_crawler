import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA11_DEV.md', import.meta.url), 'utf8');
for (const required of ['v1.6.7-beta11-dev','mhtml-diagnostics','manual-inspection-diagnostics','Anonymous','Authenticated','browser-profile']) {
  assert.ok(doc.includes(required), `BETA11_DEV.md missing ${required}`);
}
console.log('beta11-dev diagnostic documentation smoke test passed');
