import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildManifestMetadata } from './mhtml-manifest-metadata.mjs';

const PERIODIC_CAPTURE_INTERVAL_MS = 10_000;
const MAX_SUMMARY_INTERESTING_SEQUENCES = 500;

function sanitizeFilenamePart(value) {
  return String(value || 'snapshot')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'snapshot';
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sortedStrings(values) {
  return [...new Set((values || []).map(value => String(value || '')).filter(Boolean))].sort();
}

async function readPackageVersion(projectRoot) {
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
    return String(packageJson?.version || '');
  } catch {
    return '';
  }
}

async function readGitHead(projectRoot) {
  try {
    const gitPath = path.join(projectRoot, '.git');
    const stat = await fs.stat(gitPath);
    if (!stat.isDirectory()) return '';
    const head = (await fs.readFile(path.join(gitPath, 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return /^[0-9a-f]{40}$/i.test(head) ? head : '';
    const ref = head.slice(5).trim();
    const value = (await fs.readFile(path.join(gitPath, ref), 'utf8')).trim();
    return /^[0-9a-f]{40}$/i.test(value) ? value : '';
  } catch {
    return '';
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function finalStateFromEntry(entry = {}) {
  return {
    stage: entry.stage || '',
    phase: entry.phase || '',
    retainedTurns: Number(entry.retainedTurns || 0),
    retainedRevision: Number(entry.retainedRevision || entry.semanticRetainedRevision || 0),
    retainedCorpusFingerprint: entry.retainedCorpusFingerprint || '',
    oldestRetained: entry.oldestRetained || 'none',
    newestRetained: entry.newestRetained || 'none',
    oldestConverged: entry.oldestConverged ?? null,
    hydrationConflictsUnresolved: Number(entry.hydrationConflictsUnresolved || 0),
    hydrationConflictsResolved: Number(entry.hydrationConflictsResolved || 0),
    turnProcessingFailures: Number(entry.turnProcessingFailures || 0),
    scanLimitEvents: Number(entry.scanLimitEvents || 0),
    expansionLimitEvents: Number(entry.expansionLimitEvents || 0),
    hydrationTimeoutEvents: Number(entry.hydrationTimeoutEvents || 0),
    retainedUnresolvedTurns: Number(entry.retainedUnresolvedTurns || 0),
    retainedUnresolvedDisclosures: Number(entry.retainedUnresolvedDisclosures || 0),
    reconciliationConverged: entry.reconciliationConverged ?? null,
    mountRetentionSealed: Boolean(entry.mountRetentionSealed)
  };
}

function createRunSummary({ diagnosticState, packageVersion, sourceCommit, startedAt }) {
  return {
    diagnosticSchemaVersion: 2,
    diagnosticId: diagnosticState.id,
    sourceUrl: diagnosticState.url,
    sessionMode: diagnosticState.sessionMode,
    crawlerVersion: packageVersion,
    sourceCommit,
    startedAt,
    endedAt: '',
    snapshotCount: 0,
    failedSnapshotCount: 0,
    totalMhtmlBytes: 0,
    captureRequestCount: 0,
    coalescedRequestCount: 0,
    firstCapturedAt: '',
    lastCapturedAt: '',
    firstRetainedRevision: null,
    lastRetainedRevision: 0,
    maximumRetainedRevision: 0,
    maximumRetainedTurns: 0,
    maximumNavigationAmplifiedRequests: 0,
    minimumScrollClient: null,
    maximumScrollClient: 0,
    minimumScrollHeight: null,
    maximumScrollHeight: 0,
    retainedTurnIds: [],
    hydrationConflictTurnIds: [],
    turnProcessingFailureTurnIds: [],
    hydrationTimeoutTurnIds: [],
    unresolvedTurnIdsAtEnd: [],
    interestingSequenceCount: 0,
    interestingSequences: [],
    phaseRanges: [],
    finalState: {}
  };
}

function updateRunSummary(summary, entry) {
  summary.snapshotCount++;
  summary.failedSnapshotCount += entry.ok ? 0 : 1;
  summary.totalMhtmlBytes += Number(entry.bytes || 0);
  summary.captureRequestCount = Math.max(summary.captureRequestCount, Number(entry.requestId || 0));
  summary.coalescedRequestCount += Number(entry.coalescedRequests || 0);
  summary.firstCapturedAt ||= entry.capturedAt || '';
  summary.lastCapturedAt = entry.capturedAt || summary.lastCapturedAt;

  const revision = Number(entry.retainedRevision || entry.semanticRetainedRevision || 0);
  if (summary.firstRetainedRevision == null) summary.firstRetainedRevision = revision;
  summary.lastRetainedRevision = revision;
  summary.maximumRetainedRevision = Math.max(summary.maximumRetainedRevision, revision);
  summary.maximumRetainedTurns = Math.max(summary.maximumRetainedTurns, Number(entry.retainedTurns || 0));
  summary.maximumNavigationAmplifiedRequests = Math.max(
    summary.maximumNavigationAmplifiedRequests,
    Number(entry.navigationAmplifiedRequests || 0)
  );

  const client = Number(entry.scrollClient || entry.liveScrollClient || 0);
  if (summary.minimumScrollClient == null || client < summary.minimumScrollClient) summary.minimumScrollClient = client;
  summary.maximumScrollClient = Math.max(summary.maximumScrollClient, client);
  const height = Number(entry.scrollHeight || entry.liveScrollHeight || 0);
  if (summary.minimumScrollHeight == null || height < summary.minimumScrollHeight) summary.minimumScrollHeight = height;
  summary.maximumScrollHeight = Math.max(summary.maximumScrollHeight, height);

  if (Array.isArray(entry.retainedTurnIds)) {
    summary.retainedTurnIds = sortedStrings([...summary.retainedTurnIds, ...entry.retainedTurnIds]);
  } else if (Array.isArray(entry.newlyRetainedTurnIds)) {
    summary.retainedTurnIds = sortedStrings([...summary.retainedTurnIds, ...entry.newlyRetainedTurnIds]);
  }
  if (Array.isArray(entry.hydrationConflictTurnIdsFull)) {
    summary.hydrationConflictTurnIds = sortedStrings([...summary.hydrationConflictTurnIds, ...entry.hydrationConflictTurnIdsFull]);
  }
  if (Array.isArray(entry.newHydrationConflictTurnIds)) {
    summary.hydrationConflictTurnIds = sortedStrings([...summary.hydrationConflictTurnIds, ...entry.newHydrationConflictTurnIds]);
  }
  if (Array.isArray(entry.turnProcessingFailureTurnIdsFull)) {
    summary.turnProcessingFailureTurnIds = sortedStrings([...summary.turnProcessingFailureTurnIds, ...entry.turnProcessingFailureTurnIdsFull]);
  }
  if (Array.isArray(entry.newTurnProcessingFailureTurnIds)) {
    summary.turnProcessingFailureTurnIds = sortedStrings([...summary.turnProcessingFailureTurnIds, ...entry.newTurnProcessingFailureTurnIds]);
  }
  if (Array.isArray(entry.hydrationTimeoutTurnIdsFull)) {
    summary.hydrationTimeoutTurnIds = sortedStrings([...summary.hydrationTimeoutTurnIds, ...entry.hydrationTimeoutTurnIdsFull]);
  }
  if (Array.isArray(entry.newHydrationTimeoutTurnIds)) {
    summary.hydrationTimeoutTurnIds = sortedStrings([...summary.hydrationTimeoutTurnIds, ...entry.newHydrationTimeoutTurnIds]);
  }
  if (Array.isArray(entry.retainedUnresolvedTurnIdsFull)) summary.unresolvedTurnIdsAtEnd = sortedStrings(entry.retainedUnresolvedTurnIdsFull);
  else {
    if (Array.isArray(entry.newUnresolvedTurnIds)) {
      summary.unresolvedTurnIdsAtEnd = sortedStrings([...summary.unresolvedTurnIdsAtEnd, ...entry.newUnresolvedTurnIds]);
    }
    if (Array.isArray(entry.resolvedUnresolvedTurnIds)) {
      const resolved = new Set(entry.resolvedUnresolvedTurnIds);
      summary.unresolvedTurnIdsAtEnd = summary.unresolvedTurnIdsAtEnd.filter(id => !resolved.has(id));
    }
  }

  const phaseKey = [entry.stage || '', entry.phase || '', entry.direction || ''].join('|');
  const lastRange = summary.phaseRanges.at(-1);
  const phaseChanged = !lastRange || lastRange.key !== phaseKey;
  if (phaseChanged) {
    summary.phaseRanges.push({
      key: phaseKey,
      stage: entry.stage || '',
      phase: entry.phase || '',
      direction: entry.direction || '',
      firstSequence: entry.sequence,
      lastSequence: entry.sequence
    });
  } else {
    lastRange.lastSequence = entry.sequence;
  }

  const interesting = !entry.ok ||
    entry.reason === 'manual-inspection-change' ||
    entry.semanticChangedSincePreviousCapture === true ||
    Number(entry.coalescedRequests || 0) > 0 ||
    Number(entry.navigationAmplifiedRequestsDelta || 0) > 0 ||
    (entry.changedTurnIds?.length || 0) > 0 ||
    (entry.newHydrationConflictTurnIds?.length || 0) > 0 ||
    (entry.resolvedHydrationConflictTurnIds?.length || 0) > 0 ||
    (entry.newTurnProcessingFailureTurnIds?.length || 0) > 0 ||
    (entry.newHydrationTimeoutTurnIds?.length || 0) > 0 ||
    (entry.newUnresolvedTurnIds?.length || 0) > 0 ||
    (entry.resolvedUnresolvedTurnIds?.length || 0) > 0 ||
    phaseChanged;
  if (interesting) {
    summary.interestingSequenceCount++;
    if (summary.interestingSequences.length < MAX_SUMMARY_INTERESTING_SEQUENCES) {
      summary.interestingSequences.push(entry.sequence);
    }
  }
  summary.finalState = finalStateFromEntry(entry);
}

/**
 * Keep periodic MHTML as an idle safety net instead of an independent stream.
 * Every event-driven capture postpones the next periodic snapshot. If nothing
 * else is captured for intervalMs, one periodic snapshot is taken and another
 * idle interval begins.
 */
export function createIdlePeriodicScheduler(onIdle, {
  intervalMs = PERIODIC_CAPTURE_INTERVAL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  if (typeof onIdle !== 'function') throw new TypeError('onIdle must be a function.');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new TypeError('intervalMs must be positive.');

  let timer = null;
  let started = false;
  let stopped = false;

  const arm = () => {
    if (!started || stopped) return;
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (stopped) return;
      onIdle();
      arm();
    }, intervalMs);
    timer?.unref?.();
  };

  return {
    start() {
      if (started || stopped) return false;
      started = true;
      arm();
      return true;
    },
    noteActivity() {
      if (!started || stopped) return;
      arm();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    }
  };
}

async function pageExecutionState(page) {
  return page.evaluate(() => {
    const crawler = window.__archiveCrawler;
    const metrics = crawler?.metrics?.() || {};
    const navigation = window.__archiveCrawlerNavigation || {};
    const foreground = window.__archiveForegroundProtection || {};
    const focusTelemetry = window.__archiveFocusTelemetry || {};
    return {
      visibilityState: document.visibilityState || '',
      documentHidden: Boolean(document.hidden),
      documentHasFocus: Boolean(document.hasFocus?.()),
      focusEmulation: Boolean(foreground.focusEmulation),
      idleOverride: Boolean(foreground.idleOverride),
      lifecycleActive: Boolean(foreground.lifecycleActive),
      foregroundProtectionInstalledAt: foreground.installedAt || '',
      foregroundReassertions: Number(foreground.reassertions || 0),
      foregroundLastReassertedAt: foreground.lastReassertedAt || '',
      foregroundPreInstallHasFocus: foreground.preInstallHasFocus ?? null,
      foregroundPreInstallVisibilityState: foreground.preInstallVisibilityState || '',
      foregroundPostInstallHasFocus: foreground.postInstallHasFocus ?? null,
      focusEventCount: Number(focusTelemetry.focusEvents || 0),
      blurEventCount: Number(focusTelemetry.blurEvents || 0),
      visibilityChangeCount: Number(focusTelemetry.visibilityChanges || 0),
      lastFocusVisibilityEvent: focusTelemetry.lastEvent || '',
      lastFocusVisibilityEventAt: focusTelemetry.lastEventAt || '',
      liveScrollTop: Number(metrics.top ?? window.scrollY ?? 0),
      liveScrollHeight: Number(metrics.height ?? document.scrollingElement?.scrollHeight ?? 0),
      liveScrollClient: Number(metrics.client ?? window.innerHeight ?? 0),
      navigationAssistActive: Boolean(navigation.active),
      navigationStagnantSteps: Number(navigation.stagnantSteps || 0),
      navigationLogicalProgress: navigation.lastLogicalProgress !== false,
      navigationRequestedTop: Number(navigation.lastRequestedTop || 0),
      navigationAppliedTop: Number(navigation.lastAppliedTop || 0),
      navigationLeadingTurn: navigation.lastLeadingTurn || '',
      navigationTrailingTurn: navigation.lastTrailingTurn || '',
      navigationVisibleTurns: Number(navigation.lastVisibleCount || 0),
      navigationAmplifiedRequests: Number(navigation.amplifiedRequests || 0),
      navigationDirectionResets: Number(navigation.directionResets || 0)
    };
  }).catch(() => ({}));
}

/**
 * Capture Chromium's own MHTML serialization for a live page. Capture requests
 * are coalesced: one snapshot may be active and only the newest pending request
 * is retained. The manifest records request/coalescing provenance and the MHTML
 * hash so a later audit can request exact snapshots by sequence and verify them.
 */
export async function createMhtmlRecorder(projectRoot, diagnosticState, page) {
  const directory = path.join(projectRoot, 'mhtml-diagnostics', diagnosticState.id);
  await fs.mkdir(directory, { recursive: true });

  const manifestPath = path.join(directory, 'manifest.jsonl');
  const summaryPath = path.join(directory, 'summary.json');
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Page.enable').catch(() => {});

  const startedAt = new Date().toISOString();
  const packageVersion = await readPackageVersion(projectRoot);
  const sourceCommit = process.env.CHATGPT_CRAWLER_COMMIT || process.env.GITHUB_SHA || await readGitHead(projectRoot);
  const runSummary = createRunSummary({ diagnosticState, packageVersion, sourceCommit, startedAt });

  let sequenceNumber = 0;
  let requestNumber = 0;
  let closed = false;
  let pendingCapture = null;
  let drainPromise = null;
  let idlePeriodic;
  let previousDiagnosticSample = null;
  let previousCapturedAt = null;
  let previousNavigationAmplifiedRequests = 0;

  async function appendManifest(entry) {
    await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  async function captureOne(request) {
    const { reason, metadata, requestedAt, requestId, coalescedRequests, coalescedReasons } = request;
    sequenceNumber++;
    const filenameBase = [
      String(sequenceNumber).padStart(4, '0'),
      timestampForFilename(requestedAt),
      sanitizeFilenamePart(diagnosticState.sessionMode),
      sanitizeFilenamePart(reason)
    ].join('-');
    const filename = `${filenameBase}.mhtml`;
    const filePath = path.join(directory, filename);
    const executionState = await pageExecutionState(page);
    const rawSample = metadata?.__diagnosticSample || null;
    const explicitMetadata = { ...(metadata || {}) };
    delete explicitMetadata.__diagnosticSample;
    const sampledMetadata = rawSample
      ? buildManifestMetadata(rawSample, previousDiagnosticSample, {
          forceDetails: sequenceNumber === 1 || reason === 'manual-inspection-change'
        })
      : {};
    if (rawSample) previousDiagnosticSample = rawSample;

    const capturedAt = new Date();
    const amplified = Number(executionState.navigationAmplifiedRequests || 0);
    const commonMetadata = {
      sequence: sequenceNumber,
      requestId,
      requestedAt: requestedAt.toISOString(),
      capturedAt: capturedAt.toISOString(),
      captureLatencyMs: Math.max(0, capturedAt.getTime() - requestedAt.getTime()),
      elapsedSincePreviousCaptureMs: previousCapturedAt ? Math.max(0, capturedAt.getTime() - previousCapturedAt.getTime()) : null,
      coalescedRequests: Number(coalescedRequests || 0),
      coalescedReasons: Array.isArray(coalescedReasons) ? coalescedReasons.slice(-20) : [],
      reason,
      sessionMode: diagnosticState.sessionMode,
      diagnosticId: diagnosticState.id,
      crawlerVersion: packageVersion,
      sourceCommit,
      sourceUrl: diagnosticState.url,
      stage: diagnosticState.stage || '',
      phase: diagnosticState.phase || '',
      pass: diagnosticState.pass || 0,
      direction: diagnosticState.direction || '',
      step: diagnosticState.step || 0,
      mountedTurns: diagnosticState.mountedTurns || 0,
      retainedTurns: diagnosticState.retainedTurns || 0,
      oldestRetained: diagnosticState.oldestRetained || 'none',
      newestRetained: diagnosticState.newestRetained || 'none',
      mountedFirst: diagnosticState.mountedFirst || 'none',
      mountedLast: diagnosticState.mountedLast || 'none',
      scrollTop: diagnosticState.scrollTop ?? executionState.liveScrollTop ?? 0,
      scrollHeight: diagnosticState.scrollHeight || executionState.liveScrollHeight || 0,
      scrollClient: diagnosticState.scrollClient || executionState.liveScrollClient || 0,
      preBlocks: diagnosticState.preBlocks || 0,
      codeBlocks: diagnosticState.codeBlocks || 0,
      appBlocks: diagnosticState.appBlocks || 0,
      ...executionState,
      navigationAmplifiedRequestsDelta: Math.max(0, amplified - previousNavigationAmplifiedRequests),
      ...sampledMetadata,
      ...explicitMetadata
    };
    previousCapturedAt = capturedAt;
    previousNavigationAmplifiedRequests = amplified;

    let entry;
    try {
      const snapshot = await cdpSession.send('Page.captureSnapshot', { format: 'mhtml' });
      const mhtml = String(snapshot?.data || '');
      await fs.writeFile(filePath, mhtml, 'utf8');
      entry = {
        ...commonMetadata,
        filename,
        bytes: Buffer.byteLength(mhtml, 'utf8'),
        sha256: sha256(mhtml),
        ok: true
      };
    } catch (error) {
      entry = {
        ...commonMetadata,
        filename,
        bytes: 0,
        sha256: '',
        ok: false,
        error: error?.message || String(error)
      };
    }

    await appendManifest(entry).catch(() => {});
    updateRunSummary(runSummary, entry);
  }

  async function drainCaptures() {
    while (!closed && pendingCapture) {
      const request = pendingCapture;
      pendingCapture = null;
      await captureOne(request);
    }
  }

  function capture(reason, metadata = {}) {
    if (closed) return drainPromise || Promise.resolve();

    if (reason !== 'periodic-10s') idlePeriodic?.noteActivity();

    requestNumber++;
    let coalescedRequests = 0;
    let coalescedReasons = [];
    if (pendingCapture) {
      coalescedRequests = Number(pendingCapture.coalescedRequests || 0) + 1;
      coalescedReasons = [
        ...(pendingCapture.coalescedReasons || []),
        pendingCapture.reason
      ].slice(-20);
    }
    pendingCapture = {
      reason,
      metadata,
      requestedAt: new Date(),
      requestId: requestNumber,
      coalescedRequests,
      coalescedReasons
    };

    ensureDrain();
    return drainPromise || Promise.resolve();
  }

  function ensureDrain() {
    if (closed || drainPromise) return;
    drainPromise = drainCaptures()
      .catch(() => {})
      .finally(() => {
        drainPromise = null;
        if (!closed && pendingCapture) ensureDrain();
      });
  }

  idlePeriodic = createIdlePeriodicScheduler(() => {
    void capture('periodic-10s');
  });

  function startPeriodic() {
    idlePeriodic.start();
  }

  async function writeSummary() {
    runSummary.endedAt = new Date().toISOString();
    runSummary.captureRequestCount = Math.max(runSummary.captureRequestCount, requestNumber);
    if (runSummary.firstRetainedRevision == null) runSummary.firstRetainedRevision = 0;
    await fs.writeFile(summaryPath, `${JSON.stringify(runSummary, null, 2)}\n`, 'utf8');
  }

  async function close() {
    if (closed) return;
    idlePeriodic.stop();
    await drainPromise?.catch(() => {});
    if (pendingCapture) {
      ensureDrain();
      await drainPromise?.catch(() => {});
    }
    closed = true;
    pendingCapture = null;
    await writeSummary().catch(() => {});
    await cdpSession.detach().catch(() => {});
  }

  return { directory, manifestPath, summaryPath, capture, startPeriodic, close };
}
