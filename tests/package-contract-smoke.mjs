import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(packageJson.version, '1.7.0-beta3-dev');
assert.equal(packageJson.scripts?.start, 'node server-dev.mjs');

for (const required of [
  'server.mjs',
  'server-dev.mjs',
  'V1_7_BETA1_DEV.md',
  'README.v1.7.0-beta1-dev.txt',
  'V1_7_BETA2_DEV.md',
  'README.v1.7.0-beta2-dev.txt',
  'V1_7_BETA3_DEV.md',
  'README.v1.7.0-beta3-dev.txt',
  'src/archive-integrity.mjs',
  'DIAGNOSTIC_BUILD_ONLY',
  'public/index.html',
  'public/preview.html',
  'src/crawler.mjs',
  'src/crawler-core.mjs',
  'src/crawler-base.mjs',
  'src/crawler-navigation.mjs',
  'src/crawler-disclosure-state.mjs',
  'src/crawler-mount-retention.mjs',
  'src/transient-context-retention.mjs',
  'src/chromium-background-protection.mjs',
  'src/runtime-browser.mjs',
  'src/mhtml-dev-hook.mjs',
  'src/mhtml-recorder.mjs',
  'src/mhtml-start-gate.mjs',
  'src/manual-inspection.mjs',
  'start-windows.bat',
  'start-linux.sh',
  'start-macos.sh'
]) {
  assert.ok(fs.existsSync(path.join(root, required)), `required v1.7 beta3 file missing: ${required}`);
}


console.log('v1.7 beta3 package contract smoke test passed');
