import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

assert.equal(packageJson.scripts?.start, 'node server-dev.mjs');
assert.ok(fs.existsSync(path.join(root, 'server.mjs')), 'server.mjs must remain present');
assert.ok(fs.existsSync(path.join(root, 'server-dev.mjs')), 'diagnostic package must contain server-dev.mjs');

for (const launcher of ['start-windows.bat', 'start-linux.sh', 'start-macos.sh']) {
  const source = fs.readFileSync(path.join(root, launcher), 'utf8');
  assert.match(source, /server-dev\.mjs/, `${launcher} must invoke the development diagnostic entrypoint`);
  assert.doesNotMatch(source, /beta11-dev/i, `${launcher} must not present the current build as beta11-dev`);
}

const windowsStart = fs.readFileSync(path.join(root, 'start-windows.bat'), 'utf8');
const windowsSetup = fs.readFileSync(path.join(root, 'setup-windows.bat'), 'utf8');
assert.match(windowsStart, /NODE_MAJOR/);
assert.match(windowsStart, /LSS 20/);
assert.match(windowsStart, /if not defined PORT set "PORT=3000"/);
assert.match(windowsStart, /http:\/\/localhost:%PORT%/);
assert.match(windowsSetup, /NODE_MAJOR/);
assert.match(windowsSetup, /LSS 20/);

console.log('v1.7 beta3 launcher parity smoke test passed');
