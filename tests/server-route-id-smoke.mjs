import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
for (const route of ['status','preview','download','cancel']) {
  assert.ok(server.includes(`/api/archive/${route}/:id`), `archive ${route} route must use :id`);
}

console.log('beta11 archive route id smoke test passed');
