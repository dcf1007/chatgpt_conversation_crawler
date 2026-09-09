import assert from 'node:assert/strict';
import fs from 'node:fs';
const doc = fs.readFileSync(new URL('../BETA13_DEV.md', import.meta.url), 'utf8');
for (const required of ['v1.6.7-beta13-dev','semantic crawler convergence','MHTML diagnostics','manual-inspection diagnostics','beta7','beta12','retained revision','uploaded-image sanitizer','reference-aware']) {
  assert.ok(doc.includes(required), `BETA13_DEV.md missing ${required}`);
}
console.log('beta13-dev diagnostic documentation smoke test passed');
