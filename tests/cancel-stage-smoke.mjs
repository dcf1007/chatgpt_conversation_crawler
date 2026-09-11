import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
assert.match(server, /stage:\s*cancelled\s*\?\s*'cancelled'\s*:\s*'error'/, 'terminal error path must set explicit cancelled/error stage');
assert.match(server, /state:\s*cancelled\s*\?\s*'cancelled'\s*:\s*'error'/, 'terminal error path must set explicit state');

console.log('terminal stage smoke test passed');
