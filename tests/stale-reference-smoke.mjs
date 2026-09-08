import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['server.mjs', 'public', 'src', 'start-windows.bat', 'start-linux.sh', 'start-macos.sh'];
const files = [];
for (const entry of roots) {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) continue;
  if (fs.statSync(full).isDirectory()) {
    for (const name of fs.readdirSync(full)) {
      const candidate = path.join(full, name);
      if (fs.statSync(candidate).isFile()) files.push(candidate);
    }
  } else files.push(full);
}
const text = files.map(file => `${path.relative(root, file)}\n${fs.readFileSync(file, 'utf8')}`).join('\n');

for (const stale of ['server-dev.mjs', 'installBeta8Diagnostics', 'crawler-page-diagnostics.mjs']) {
  assert.ok(!text.includes(stale), `stale clean-runtime reference remains: ${stale}`);
}
assert.ok(!/params\.get\(['"]job['"]\)/.test(text), 'legacy preview query parameter remains');
assert.ok(!/\bjobId\b/.test(text), 'legacy archive identifier jobId remains');

console.log('beta11 stale-reference smoke test passed');
