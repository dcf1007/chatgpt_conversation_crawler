import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 39000 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`server exited early (${child.exitCode}): ${output}`);
    try {
      const response = await fetch(`${base}/`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${output}`);
}

async function stopChild() {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 1500))
  ]);
  if (exited || child.exitCode != null) return;
  child.kill('SIGKILL');
  if (child.exitCode == null) await new Promise(resolve => child.once('exit', resolve));
}

try {
  await waitForServer();
  const start = await fetch(`${base}/api/archive/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://chatgpt.com/share/current-contract-test', sessionMode: 'anonymous' })
  });
  assert.equal(start.status, 202);
  const body = await start.json();
  assert.deepEqual(Object.keys(body), ['id']);
  assert.match(body.id, /^[0-9a-f-]{36}$/i);

  const status = await fetch(`${base}/api/archive/status/${encodeURIComponent(body.id)}`);
  assert.ok(status.ok);
  const job = await status.json();
  assert.equal(job.id, body.id);
  assert.equal(typeof job.stage, 'string');
  assert.equal(job.progressLimits.scanMaxSteps, 2000);
  assert.equal(job.progressLimits.scanEndpointStableChecks, 6);
  assert.equal(job.progressLimits.oldestRequiredQuietChecks, 12);
  assert.equal(job.progressLimits.reconciliationMaxPasses, 2);
  assert.equal(job.progressLimits.turnWorkQueueMaxItems, 10000);
  assert.equal(Object.prototype.hasOwnProperty.call(job.progressLimits, 'scanPasses'), false,
    'beta3 progress limits must not preserve the obsolete fixed three-pass model');

  const preview = await fetch(`${base}/api/archive/preview/${encodeURIComponent(body.id)}`);
  assert.ok([200, 204].includes(preview.status));

  const download = await fetch(`${base}/api/archive/download/${encodeURIComponent(body.id)}`);
  assert.ok([200, 409].includes(download.status));

  console.log('server beta3 start/status/preview/download integration contract passed');
} finally {
  await stopChild();
}
