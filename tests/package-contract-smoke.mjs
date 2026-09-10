import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.version, '1.6.7-beta14.1-dev');
assert.equal(packageJson.scripts?.start, 'node server-dev.mjs');

for (const required of [
  'server.mjs',
  'server-dev.mjs',
  'BETA11.md',
  'BETA12_DEV.md',
  'BETA13_DEV.md',
  'BETA13_1_DEV.md',
  'BETA14_DEV.md',
  'BETA14_1_DEV.md',
  'README.beta12-dev.txt',
  'README.beta13-dev.txt',
  'README.beta13.1-dev.txt',
  'README.beta14-dev.txt',
  'README.beta14.1-dev.txt',
  'DIAGNOSTIC_BUILD_ONLY',
  'public/index.html',
  'public/preview.html',
  'src/crawler.mjs',
  'src/crawler-core.mjs',
  'src/crawler-base.mjs',
  'src/crawler-disclosure-state.mjs',
  'src/crawler-mount-retention.mjs',
  'src/transient-context-retention.mjs',
  'src/chromium-background-protection.mjs',
  'src/runtime-browser.mjs',
  'src/manual-scroll-assist.mjs',
  'src/mhtml-dev-hook.mjs',
  'src/mhtml-recorder.mjs',
  'src/mhtml-start-gate.mjs',
  'src/manual-inspection.mjs',
  'start-windows.bat',
  'start-linux.sh',
  'start-macos.sh'
]) {
  assert.ok(fs.existsSync(path.join(root, required)), `required beta14.1-dev file missing: ${required}`);
}

assert.ok(!fs.existsSync(path.join(root, 'BETA11_DEV.md')), 'beta14.1-dev package must not retain superseded beta11-dev instructions');
assert.ok(!fs.existsSync(path.join(root, 'README.beta11-dev.txt')), 'beta14.1-dev package must not retain superseded beta11-dev package note');
assert.ok(!fs.existsSync(path.join(root, 'src/crawler-page-diagnostics.mjs')), 'beta14.1-dev must not revive the old crawler-page-diagnostics implementation');

console.log('beta14.1-dev package contract smoke test passed');
