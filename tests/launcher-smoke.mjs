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
  assert.doesNotMatch(source, /\bbeta\d/i, `${launcher} must not present a development-version label`);
}

const windowsStart = fs.readFileSync(path.join(root, 'start-windows.bat'), 'utf8');
const windowsSetup = fs.readFileSync(path.join(root, 'setup-windows.bat'), 'utf8');
assert.match(windowsStart, /NODE_MAJOR/);
assert.match(windowsStart, /LSS 20/);
assert.match(windowsStart, /if not defined PORT set "PORT=3000"/);
assert.match(windowsStart, /http:\/\/localhost:%PORT%/);
assert.match(windowsSetup, /NODE_MAJOR/);
assert.match(windowsSetup, /LSS 20/);

// A quoted executable path such as C:\Program Files\nodejs\node.exe must not be
// placed inside FOR /F command substitution. cmd.exe reparses that nested command
// and can treat C:\Program as the executable. The setup script must invoke the
// resolved Node executable directly and read the result without a nested command.
assert.doesNotMatch(
  windowsSetup,
  /for\s+\/f[^\r\n]*NODE_EXE/i,
  'setup-windows.bat must not execute the resolved Node path through FOR /F command substitution'
);
assert.match(
  windowsSetup,
  /"%NODE_EXE%"\s+-p\s+"Number\(process\.versions\.node\.split\('\.'\)\[0\]\)"\s*>\s*"%NODE_MAJOR_FILE%"/i,
  'setup-windows.bat must query Node major version through a directly quoted executable invocation'
);
assert.match(
  windowsSetup,
  /set\s+\/p\s+"NODE_MAJOR="<"%NODE_MAJOR_FILE%"/i,
  'setup-windows.bat must read the Node major version without invoking cmd.exe command substitution'
);

console.log('v1.7 beta3 launcher parity + Windows spaced-Node-path smoke test passed');
