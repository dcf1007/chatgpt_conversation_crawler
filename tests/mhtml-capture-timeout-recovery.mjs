import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMhtmlRecorder } from '../src/mhtml-recorder.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crawler-mhtml-timeout-'));
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.7.1-beta4-dev2' }), 'utf8');

let sessionCreations = 0;
let firstSessionDetached = false;
let secondSnapshotCalls = 0;

const firstSession = {
  async send(method) {
    if (method === 'Page.enable') return {};
    if (method === 'Page.captureSnapshot') return new Promise(() => {});
    throw new Error(`unexpected CDP method ${method}`);
  },
  async detach() {
    firstSessionDetached = true;
  }
};

const secondSession = {
  async send(method) {
    if (method === 'Page.enable') return {};
    if (method === 'Page.captureSnapshot') {
      secondSnapshotCalls++;
      return { data: 'recovered-mhtml' };
    }
    throw new Error(`unexpected CDP method ${method}`);
  },
  async detach() {}
};

const page = {
  context() {
    return {
      async newCDPSession() {
        sessionCreations++;
        return sessionCreations === 1 ? firstSession : secondSession;
      }
    };
  },
  async evaluate() {
    return {};
  },
  isClosed() {
    return false;
  }
};

const diagnosticState = {
  id: 'timeout-recovery-test',
  sessionMode: 'authenticated',
  url: 'https://chatgpt.com/share/test',
  stage: 'finalization',
  phase: 'Timeout recovery test',
  mountedTurns: 1,
  retainedTurns: 1
};

try {
  const recorder = await createMhtmlRecorder(root, diagnosticState, page, {
    captureTimeoutMs: 25,
    recoveryTimeoutMs: 100
  });

  const startedAt = Date.now();
  await recorder.capture('initial-loaded');
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 1000, `timed-out capture must be bounded; elapsed=${elapsed}ms`);
  assert.equal(firstSessionDetached, true, 'timed-out CDP session should be detached');
  assert.equal(sessionCreations, 2, 'timeout should create a fresh CDP session for subsequent snapshots');

  await recorder.capture('context-closing');
  await recorder.close();
  assert.equal(secondSnapshotCalls, 1, 'the recovered CDP session should serve the next forensic checkpoint');

  const rows = (await fs.readFile(recorder.manifestPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].entryType, 'mhtml');
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].captureTimedOut, true);
  assert.equal(rows[0].cdpRecovered, true);
  assert.ok(rows[0].captureDurationMs >= 20);
  assert.ok(rows[0].captureStartedAt);
  assert.ok(rows[0].captureCompletedAt);
  assert.equal(rows[1].reason, 'context-closing');
  assert.equal(rows[1].ok, true);
  assert.equal(rows[1].captureTimedOut, false);
  assert.ok(rows[1].bytes > 0);

  const summary = JSON.parse(await fs.readFile(recorder.summaryPath, 'utf8'));
  assert.equal(summary.snapshotCount, 2);
  assert.equal(summary.failedSnapshotCount, 1);
  assert.equal(summary.timedOutSnapshotCount, 1);
  assert.equal(summary.recoveredCdpSessionCount, 1);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('MHTML capture timeout + CDP recovery runtime test passed');
