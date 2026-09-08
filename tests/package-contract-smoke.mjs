import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.version, '1.6.7-beta11');

for (const required of [
  'server.mjs',
  'public/index.html',
  'public/preview.html',
  'src/crawler.mjs',
  'src/crawler-core.mjs',
  'src/crawler-base.mjs',
  'src/crawler-disclosure-state.mjs',
  'src/crawler-mount-retention.mjs',
  'src/transient-context-retention.mjs',
  'start-windows.bat',
  'start-linux.sh',
  'start-macos.sh'
]) {
  assert.ok(fs.existsSync(path.join(root, required)), `required packaged file missing: ${required}`);
}

for (const removed of [
  'server-dev.mjs',
  'src/crawler-page-diagnostics.mjs',
  'src/mhtml-dev-hook.mjs',
  'src/manual-inspection.mjs'
]) {
  assert.ok(!fs.existsSync(path.join(root, removed)), `clean beta11 must not contain development-only file: ${removed}`);
}

console.log('beta11 package contract smoke test passed');
