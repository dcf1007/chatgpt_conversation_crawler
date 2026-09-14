import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMhtmlRecorder } from '../src/mhtml-recorder.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crawler-mhtml-telemetry-'));
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.7.1-beta4-dev2' }), 'utf8');

let snapshotCalls = 0;
const cdpSession = {
  async send(method) {
    if (method === 'Page.enable') return {};
    if (method === 'Page.captureSnapshot') {
      snapshotCalls++;
      return { data: `unexpected-snapshot-${snapshotCalls}` };
    }
    throw new Error(`unexpected CDP method ${method}`);
  },
  async detach() {}
};
const page = {
  context() {
    return { async newCDPSession() { return cdpSession; } };
  },
  async evaluate() {
    return {};
  },
  isClosed() {
    return false;
  }
};

const diagnosticState = {
  id: 'telemetry-volume-test',
  sessionMode: 'authenticated',
  url: 'https://chatgpt.com/share/test',
  stage: 'traversal',
  phase: 'Forward passive discovery',
  pass: 1,
  direction: 'down',
  step: 0,
  mountedTurns: 8,
  retainedTurns: 60,
  oldestRetained: 'conversation-turn-1',
  newestRetained: 'conversation-turn-60',
  mountedFirst: 'conversation-turn-1',
  mountedLast: 'conversation-turn-8',
  scrollTop: 0,
  scrollHeight: 10_000,
  scrollClient: 900,
  preBlocks: 12,
  codeBlocks: 20,
  appBlocks: 1
};

try {
  const recorder = await createMhtmlRecorder(root, diagnosticState, page);
  const stableSemanticState = {
    retainedTurns: 60,
    retainedRevision: 140,
    semanticRetainedRevision: 140,
    timelineMarkers: 3,
    oldestRetained: 'conversation-turn-1',
    newestRetained: 'conversation-turn-60',
    preBlocks: 12,
    codeBlocks: 20,
    images: 8,
    svgs: 2,
    iframes: 1,
    appBlocks: 1,
    expansionGeneration: 75,
    retainedUnresolvedTurns: 0,
    retainedUnresolvedDisclosures: 0,
    hydrationConflictsUnresolved: 4,
    turnProcessingFailures: 0,
    hydrationTimeoutEvents: 0,
    activeTurnId: 'conversation-turn-24',
    activeTurnRevision: 4,
    activeTurnRecognizedCollapsed: 0,
    activeTurnActionableCollapsed: 0,
    activeTurnClosedDetails: 0,
    activeTurnActionableLogicalKeys: []
  };

  for (let index = 0; index < 1000; index++) {
    const sample = {
      ...stableSemanticState,
      mountedTurns: 3 + (index % 8),
      mountedFirst: `conversation-turn-${1 + (index % 50)}`,
      mountedLast: `conversation-turn-${5 + (index % 50)}`,
      scrollTop: index * 37,
      scrollHeight: 10_000 + (index % 17) * 11,
      scrollClient: 900 + (index % 5),
      phase: index % 2 ? 'Processing retained turn' : '',
      step: index
    };
    await recorder.capture('material-dom-change', { __diagnosticSample: sample });
  }
  await recorder.close();

  assert.equal(snapshotCalls, 0, '1,000 material/virtualizer events must create zero MHTML snapshots');
  const lines = (await fs.readFile(recorder.manifestPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(lines.length, 1000);
  assert.ok(lines.every(entry => entry.entryType === 'telemetry'));
  assert.ok(lines.every(entry => entry.reason === 'material-dom-change'));
  assert.ok(lines.every(entry => !Object.hasOwn(entry, 'filename')));

  const directoryEntries = await fs.readdir(recorder.directory);
  assert.equal(directoryEntries.some(name => name.endsWith('.mhtml')), false);

  const summary = JSON.parse(await fs.readFile(recorder.summaryPath, 'utf8'));
  assert.equal(summary.manifestRecordCount, 1000);
  assert.equal(summary.telemetryRecordCount, 1000);
  assert.equal(summary.snapshotCount, 0);
  assert.equal(summary.totalMhtmlBytes, 0);
  assert.equal(summary.telemetryReasonCounts['material-dom-change'], 1000);
  assert.equal(summary.mhtmlReasonCounts['material-dom-change'], undefined);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log('MHTML high-volume telemetry-only runtime test passed');
