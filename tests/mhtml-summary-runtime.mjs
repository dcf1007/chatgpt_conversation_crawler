import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMhtmlRecorder } from '../src/mhtml-recorder.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'crawler-mhtml-summary-'));
await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.7.1-beta3-dev2' }), 'utf8');

let snapshotIndex = 0;
const snapshotBodies = ['first mhtml body', 'second mhtml body'];
const cdpSession = {
  async send(method) {
    if (method === 'Page.enable') return {};
    if (method === 'Page.captureSnapshot') return { data: snapshotBodies[snapshotIndex++] };
    throw new Error(`unexpected CDP method ${method}`);
  },
  async detach() {}
};
const page = {
  context() {
    return { async newCDPSession() { return cdpSession; } };
  },
  async evaluate() {
    return {
      liveScrollTop: 0,
      liveScrollHeight: 1000,
      liveScrollClient: 500,
      navigationAmplifiedRequests: snapshotIndex,
      navigationDirectionResets: 0
    };
  }
};

const diagnosticState = {
  id: 'dev-summary-test',
  sessionMode: 'authenticated',
  url: 'https://chatgpt.com/share/test',
  stage: 'traversal',
  phase: 'Forward discovery sweep',
  pass: 0,
  direction: 'down',
  step: 1,
  mountedTurns: 1,
  retainedTurns: 1,
  oldestRetained: 'conversation-turn-1',
  newestRetained: 'conversation-turn-1',
  mountedFirst: 'conversation-turn-1',
  mountedLast: 'conversation-turn-1',
  scrollTop: 0,
  scrollHeight: 1000,
  scrollClient: 500,
  preBlocks: 0,
  codeBlocks: 0,
  appBlocks: 0
};

const recorder = await createMhtmlRecorder(root, diagnosticState, page);
const firstSample = {
  ...diagnosticState,
  retainedRevision: 1,
  semanticRetainedRevision: 1,
  retainedCorpusFingerprint: 'fp-1',
  timelineMarkers: 0,
  mountedTurnIds: ['conversation-turn-1'],
  retainedTurnIds: ['conversation-turn-1'],
  turnRevisionMap: { 'conversation-turn-1': 1 },
  hydrationConflictTurnIdsFull: [],
  turnProcessingFailureTurnIdsFull: [],
  hydrationTimeoutTurnIdsFull: [],
  retainedUnresolvedTurnIdsFull: [],
  actionableLogicalKeys: [],
  disclosureByTurn: [],
  reconciliationConverged: null,
  mountRetentionSealed: false
};
await recorder.capture('initial-loaded', { __diagnosticSample: firstSample });

const secondSample = {
  ...firstSample,
  phase: 'Forward post-processing verification',
  step: 2,
  retainedRevision: 2,
  semanticRetainedRevision: 2,
  retainedCorpusFingerprint: 'fp-2',
  retainedTurns: 2,
  newestRetained: 'conversation-turn-2',
  mountedTurnIds: ['conversation-turn-2'],
  retainedTurnIds: ['conversation-turn-1', 'conversation-turn-2'],
  turnRevisionMap: { 'conversation-turn-1': 1, 'conversation-turn-2': 1 },
  hydrationConflictTurnIdsFull: ['conversation-turn-2'],
  hydrationConflictsUnresolved: 1,
  turnProcessingFailureTurnIdsFull: ['conversation-turn-2'],
  turnProcessingFailures: 1,
  hydrationTimeoutTurnIdsFull: ['conversation-turn-2'],
  hydrationTimeoutEvents: 1,
  retainedUnresolvedTurnIdsFull: ['conversation-turn-2'],
  retainedUnresolvedTurns: 1,
  retainedUnresolvedDisclosures: 1,
  reconciliationConverged: false,
  mountRetentionSealed: true
};
Object.assign(diagnosticState, {
  phase: secondSample.phase,
  step: secondSample.step,
  retainedTurns: secondSample.retainedTurns,
  newestRetained: secondSample.newestRetained
});
await recorder.capture('material-dom-change', { __diagnosticSample: secondSample });
await recorder.close();

const manifestText = await fs.readFile(recorder.manifestPath, 'utf8');
const rows = manifestText.trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(rows.length, 2);
assert.equal(rows[0].diagnosticSchemaVersion, 2);
assert.equal(rows[0].crawlerVersion, '1.7.1-beta3-dev2');
assert.equal(rows[0].sha256, createHash('sha256').update(snapshotBodies[0]).digest('hex'));
assert.equal(rows[1].sha256, createHash('sha256').update(snapshotBodies[1]).digest('hex'));
assert.deepEqual(rows[1].newlyRetainedTurnIds, ['conversation-turn-2']);
assert.deepEqual(rows[1].newHydrationConflictTurnIds, ['conversation-turn-2']);
assert.deepEqual(rows[1].newTurnProcessingFailureTurnIds, ['conversation-turn-2']);
assert.deepEqual(rows[1].newHydrationTimeoutTurnIds, ['conversation-turn-2']);
assert.equal(rows[1].semanticChangedSincePreviousCapture, true);

const summary = JSON.parse(await fs.readFile(recorder.summaryPath, 'utf8'));
assert.equal(summary.diagnosticSchemaVersion, 2);
assert.equal(summary.crawlerVersion, '1.7.1-beta3-dev2');
assert.equal(summary.snapshotCount, 2);
assert.equal(summary.failedSnapshotCount, 0);
assert.equal(summary.maximumRetainedTurns, 2);
assert.equal(summary.maximumRetainedRevision, 2);
assert.deepEqual(summary.retainedTurnIds, ['conversation-turn-1', 'conversation-turn-2']);
assert.deepEqual(summary.hydrationConflictTurnIds, ['conversation-turn-2']);
assert.deepEqual(summary.turnProcessingFailureTurnIds, ['conversation-turn-2']);
assert.deepEqual(summary.hydrationTimeoutTurnIds, ['conversation-turn-2']);
assert.deepEqual(summary.unresolvedTurnIdsAtEnd, ['conversation-turn-2']);
assert.equal(summary.finalState.reconciliationConverged, false);
assert.equal(summary.finalState.mountRetentionSealed, true);
assert.ok(summary.interestingSequences.includes(2));
assert.equal(summary.phaseRanges.length, 2);

await fs.rm(root, { recursive: true, force: true });
console.log('MHTML enriched manifest + summary runtime smoke test passed');
