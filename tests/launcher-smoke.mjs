import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(packageJson.scripts?.start, 'node server.mjs');
assert.ok(fs.existsSync(path.join(root, 'server.mjs')), 'clean package entrypoint server.mjs must exist');
assert.ok(!fs.existsSync(path.join(root, 'server-dev.mjs')), 'clean release must not contain server-dev.mjs');

for (const launcher of ['start-windows.bat', 'start-linux.sh', 'start-macos.sh']) {
  const source = fs.readFileSync(path.join(root, launcher), 'utf8');
  assert.match(source, /server\.mjs/, `${launcher} must invoke the clean server entrypoint`);
  assert.doesNotMatch(source, /server-dev\.mjs/, `${launcher} must not invoke removed development entrypoint`);
  assert.doesNotMatch(source, /MHTML diagnostics|beta6-dev/i, `${launcher} contains stale development wording`);
}

console.log('clean launcher entrypoint regression smoke test passed');
