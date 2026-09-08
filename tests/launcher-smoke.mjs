import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(packageJson.scripts?.start, 'node server-dev.mjs');
assert.ok(fs.existsSync(path.join(root, 'server.mjs')), 'underlying beta11 server.mjs must remain present');
assert.ok(fs.existsSync(path.join(root, 'server-dev.mjs')), 'diagnostic package must contain server-dev.mjs');

for (const launcher of ['start-windows.bat', 'start-linux.sh', 'start-macos.sh']) {
  const source = fs.readFileSync(path.join(root, launcher), 'utf8');
  assert.match(source, /server-dev\.mjs/, `${launcher} must invoke the beta11-dev diagnostic entrypoint`);
  assert.doesNotMatch(source, /beta6-dev/i, `${launcher} contains stale beta6 development wording`);
  assert.match(source, /beta11-dev/i, `${launcher} should identify the diagnostic build`);
}

console.log('beta11-dev launcher entrypoint regression smoke test passed');
