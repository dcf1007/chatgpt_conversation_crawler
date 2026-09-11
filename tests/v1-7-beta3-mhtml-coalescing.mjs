import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMhtmlRecorder } from '../src/mhtml-recorder.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crawler-mhtml-coalesce-'));
let releaseFirst;
const firstBarrier = new Promise(resolve => { releaseFirst = resolve; });
let snapshotCalls = 0;

const session = {
  async send(method) {
    if (method === 'Page.enable') return {};
    if (method === 'Page.captureSnapshot') {
      snapshotCalls++;
      if (snapshotCalls === 1) await firstBarrier;
      return { data: `snapshot-${snapshotCalls}` };
    }
    throw new Error(`unexpected CDP method ${method}`);
  },
  async detach() {}
};

const page = {
  context() {
    return { async newCDPSession() { return session; } };
  },
  async evaluate() {
    return {};
  }
};

const diagnosticState = {
  id: 'coalescing-test',
  sessionMode: 'anonymous',
  url: 'https://chatgpt.com/share/test',
  stage: 'traversal',
  phase: 'Scanning conversation',
  pass: 1,
  direction: 'down',
  step: 12,
  mountedTurns: 8,
  retainedTurns: 47
};

try {
  const recorder = await createMhtmlRecorder(root, diagnosticState, page);
  const first = recorder.capture('first');
  recorder.capture('intermediate');
  recorder.capture('latest');
  releaseFirst();
  await first;
  await recorder.close();

  assert.equal(snapshotCalls, 2, 'one active snapshot may have only one coalesced successor');
  const lines = (await fs.readFile(recorder.manifestPath, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(lines.map(entry => entry.reason), ['first', 'latest']);
  assert.equal(lines[1].mountedTurns, 8);
  assert.equal(lines[1].retainedTurns, 47);
  assert.equal(Object.hasOwn(lines[1], 'turns'), false, 'ambiguous turns field must not remain in MHTML manifest');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('v1.7 beta3 MHTML coalescing smoke test passed');
