import assert from 'node:assert/strict';
import fs from 'node:fs';
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
for(const route of ['/api/archive/start','/api/archive/status/:id','/api/archive/preview/:id','/api/archive/download/:id','/api/archive/cancel/:id']) assert.ok(server.includes(route),`missing ${route}`);
console.log('beta11 route contract smoke test passed');
