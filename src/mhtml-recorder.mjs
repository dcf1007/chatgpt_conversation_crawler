import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildManifestMetadata,
  diagnosticHash,
  diagnosticSampleSignature
} from './mhtml-manifest-metadata.mjs';

const PERIODIC_CAPTURE_INTERVAL_MS = 10_000;
const MHTML_CAPTURE_TIMEOUT_MS = 60_000;
const CDP_RECOVERY_TIMEOUT_MS = 5_000;
const MAX_SUMMARY_INTERESTING_SEQUENCES = 500;
const TELEMETRY_ONLY_CAPTURE_REASONS = new Set([
  'material-dom-change',
  'lazy-resource-loaded'
]);

const TELEMETRY_FIELDS = [
  'stage',
  'phase',
  'pass',
  'direction',
  'step',
  'progressDetail',
  'scanningStatus',
  'scanComplete',
  'previewPaused',
  'mountedTurns',
  'retainedTurns',
  'retainedRevision',
  'semanticRetainedRevision',
  'timelineMarkers',
  'oldestRetained',
  'newestRetained',
  'scrollTop',
  'scrollClient',
  'mountedFirst',
  'mountedLast',
  'scrollHeight',
  'physicalMaximumTop',
  'atPhysicalTop',
  'atPhysicalBottom',
  'textLength',
  'preBlocks',
  'codeBlocks',
  'images',
  'svgs',
  'iframes',
  'appBlocks',
  'collapsed',
  'expanded',
  'expansionGeneration',
  'lastExpansionTurn',
  'lastExpansionStatus',
  'quiescentRounds',
  'requiredQuiescentRounds',
  'quiescenceConverged',
  'quiescenceScopeTurn',
  'quiescenceTimedOut',
  'retainedUnresolvedTurns',
  'retainedUnresolvedDisclosures',
  'hydrationConflictsUnresolved',
  'turnProcessingFailures',
  'hydrationTimeoutEvents',
  'scanLimitEvents',
  'expansionLimitEvents',
  'reconciliationRounds',
  'reconciliationStablePasses',
  'reconciliationConverged',
  'mountRetentionSealed',
  'manualPhase',
  'manualStepIndex',
  'manualStepCount',
  'manualStepLabel',
  'manualTargetTurnId',
  'manualTargetReason',
  'manualInteractionCount',
  'manualFinishRequested',
  'manualEventCount',
  'activeTurnId',
  'activeTurnRevision',
  'activeTurnRecognizedCollapsed',
  'activeTurnActionableCollapsed',
  'activeTurnClosedDetails',
  'activeTurnActionableLogicalKeys'
];

const TELEMETRY_SEMANTIC_FIELDS = [
  'retainedTurns',
  'retainedRevision',
  'semanticRetainedRevision',
  'timelineMarkers',
  'oldestRetained',
  'newestRetained',
  'preBlocks',
  'codeBlocks',
  'images',
  'svgs',
  'iframes',
  'appBlocks',
  'expansionGeneration',
  'retainedUnresolvedTurns',
  'retainedUnresolvedDisclosures',
  'hydrationConflictsUnresolved',
  'turnProcessingFailures',
  'hydrationTimeoutEvents',
  'reconciliationConverged',
  'mountRetentionSealed',
  'activeTurnId',
  'activeTurnRevision',
  'activeTurnRecognizedCollapsed',
  'activeTurnActionableCollapsed',
  'activeTurnClosedDetails',
  'activeTurnActionableLogicalKeys'
];

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

function normalizeTelemetryValue(value) {
  if (Array.isArray(value)) return [...value].map(item => String(item || '')).filter(Boolean).sort();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return null;
  return String(value);
}

function selectTelemetryFields(sample = {}, fields = TELEMETRY_FIELDS) {
  return Object.fromEntries(fields.map(field => [field, normalizeTelemetryValue(sample[field])]));
}

function changedTelemetryFields(previous, current) {
  if (!previous) return TELEMETRY_FIELDS.filter(field => current[field] !== null);
  return TELEMETRY_FIELDS.filter(field =>
    JSON.stringify(normalizeTelemetryValue(previous[field])) !== JSON.stringify(normalizeTelemetryValue(current[field]))
  );
}

function telemetrySemanticHash(sample = {}) {
  return diagnosticHash(selectTelemetryFields(sample, TELEMETRY_SEMANTIC_FIELDS));
}

function telemetryDeltas(previous, current) {
  const numberDelta = field => Number(current?.[field] || 0) - Number(previous?.[field] || 0);
  return {
    mountedTurnsDelta: numberDelta('mountedTurns'),
    retainedTurnsDelta: numberDelta('retainedTurns'),
    retainedRevisionDelta: numberDelta('retainedRevision'),
    scrollTopDelta: numberDelta('scrollTop'),
    scrollHeightDelta: numberDelta('scrollHeight'),
    expansionGenerationDelta: numberDelta('expansionGeneration'),
    retainedUnresolvedTurnsDelta: numberDelta('retainedUnresolvedTurns'),
    retainedUnresolvedDisclosuresDelta: numberDelta('retainedUnresolvedDisclosures'),
    hydrationConflictsUnresolvedDelta: numberDelta('hydrationConflictsUnresolved'),
    turnProcessingFailuresDelta: numberDelta('turnProcessingFailures'),
    hydrationTimeoutEventsDelta: numberDelta('hydrationTimeoutEvents')
  };
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
    manifestRecordCount: 0,
    telemetryRecordCount: 0,
    snapshotCount: 0,
    failedSnapshotCount: 0,
    timedOutSnapshotCount: 0,
    recoveredCdpSessionCount: 0,
    totalMhtmlBytes: 0,
    captureRequestCount: 0,
    coalescedRequestCount: 0,
    telemetryReasonCounts: {},
    mhtmlReasonCounts: {},
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
  summary.manifestRecordCount++;
  if (entry.entryType === 'telemetry') {
    summary.telemetryRecordCount++;
    summary.telemetryReasonCounts[entry.reason] = Number(summary.telemetryReasonCounts[entry.reason] || 0) + 1;
  } else {
    summary.snapshotCount++;
    summary.failedSnapshotCount += entry.ok ? 0 : 1;
    summary.timedOutSnapshotCount += entry.captureTimedOut ? 1 : 0;
    summary.recoveredCdpSessionCount += entry.cdpRecovered ? 1 : 0;
    summary.totalMhtmlBytes += Number(entry.bytes || 0);
    summary.captureRequestCount = Math.max(summary.captureRequestCount, Number(entry.requestId || 0));
    summary.coalescedRequestCount += Number(entry.coalescedRequests || 0);
    summary.mhtmlReasonCounts[entry.reason] = Number(summary.mhtmlReasonCounts[entry.reason] || 0) + 1;
    summary.firstCapturedAt ||= entry.capturedAt || '';
    summary.lastCapturedAt = entry.capturedAt || summary.lastCapturedAt;
  }

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
  if (Array.isArray(entry.retainedUnresolvedTurnIdsFull)) {
    summary.unresolvedTurnIdsAtEnd = sortedStrings(entry.retainedUnresolvedTurnIdsFull);
  } else {
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

  const interesting =
    (entry.entryType === 'mhtml' && entry.ok === false) ||
    entry.reason === 'manual-inspection-change' ||
    entry.semanticChangedSincePreviousCapture === true ||
    entry.semanticChangedSincePreviousTelemetry === true ||
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
 * Event activity postpones the next periodic snapshot even when it does not
 * itself produce a capture. If nothing happens for intervalMs, one idle sample
 * is requested and another inactivity interval begins.
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

function timeoutError(message, timeoutMs) {
  const error = new Error(`${message} after ${timeoutMs} ms.`);
  error.code = 'MHTML_CAPTURE_TIMEOUT';
  return error;
}

function withTimeout(promise, timeoutMs, message) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(promise);
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(message, timeoutMs)), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function recoverableCdpError(error) {
  if (error?.code === 'MHTML_CAPTURE_TIMEOUT') return true;
  return /target.*closed|context.*closed|browser.*closed|session.*closed|session.*detached|not attached|protocol error/i.test(
    error?.message || String(error || '')
  );
}

/**
 * Capture Chromium's own MHTML serialization for a live page. MHTML requests
 * are coalesced: one snapshot may be active and only the newest pending request
 * is retained. High-frequency page events are written separately as JSONL
 * telemetry and never enter this queue merely because the DOM moved.
 */
export async function createMhtmlRecorder(projectRoot, diagnosticState, page, {
  captureTimeoutMs = MHTML_CAPTURE_TIMEOUT_MS,
  recoveryTimeoutMs = CDP_RECOVERY_TIMEOUT_MS
} = {}) {
  const directory = path.join(projectRoot, 'mhtml-diagnostics', diagnosticState.id);
  await fs.mkdir(directory, { recursive: true });

  const manifestPath = path.join(directory, 'manifest.jsonl');
  const summaryPath = path.join(directory, 'summary.json');
  const startedAt = new Date().toISOString();
  const packageVersion = await readPackageVersion(projectRoot);
  const sourceCommit = process.env.CHATGPT_CRAWLER_COMMIT || process.env.GITHUB_SHA || await readGitHead(projectRoot);
  const runSummary = createRunSummary({ diagnosticState, packageVersion, sourceCommit, startedAt });

  let cdpSession = null;
  let manifestSequence = 0;
  let snapshotSequence = 0;
  let requestNumber = 0;
  let acceptingCaptures = true;
  let closed = false;
  let pendingCapture = null;
  let drainPromise = null;
  let manifestWritePromise = Promise.resolve();
  let idlePeriodic;
  let idleCapture = null;
  let previousMhtmlDiagnosticSample = null;
  let previousTelemetrySample = null;
  let previousCapturedAt = null;
  let previousNavigationAmplifiedRequests = 0;

  async function createCdpSession() {
    const session = await withTimeout(
      page.context().newCDPSession(page),
      recoveryTimeoutMs,
      'Creating diagnostic CDP session timed out'
    );
    await withTimeout(
      session.send('Page.enable').catch(() => {}),
      recoveryTimeoutMs,
      'Enabling diagnostic CDP Page domain timed out'
    );
    return session;
  }

  async function detachCdpSession(session) {
    if (!session) return;
    await withTimeout(
      session.detach().catch(() => {}),
      recoveryTimeoutMs,
      'Detaching diagnostic CDP session timed out'
    ).catch(() => {});
  }

  async function recoverCdpSession() {
    const staleSession = cdpSession;
    cdpSession = null;
    await detachCdpSession(staleSession);
    if (closed || page.isClosed?.()) return false;
    try {
      cdpSession = await createCdpSession();
      return true;
    } catch {
      cdpSession = null;
      return false;
    }
  }

  cdpSession = await createCdpSession();

  function appendManifest(entry) {
    manifestWritePromise = manifestWritePromise.then(async () => {
      await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
      updateRunSummary(runSummary, entry);
    });
    return manifestWritePromise;
  }

  function commonStateMetadata(executionState = {}) {
    const amplified = Number(executionState.navigationAmplifiedRequests || 0);
    const common = {
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
      navigationAmplifiedRequestsDelta: Math.max(0, amplified - previousNavigationAmplifiedRequests)
    };
    previousNavigationAmplifiedRequests = amplified;
    return common;
  }

  async function recordTelemetry(reason, sample = {}, metadata = {}) {
    if (closed || !acceptingCaptures) return;
    const recordedAt = new Date();
    const previous = previousTelemetrySample;
    const current = sample || {};
    const currentSemanticHash = telemetrySemanticHash(current);
    const previousSemanticHash = previous ? telemetrySemanticHash(previous) : '';
    const executionState = await pageExecutionState(page);
    const explicitMetadata = { ...(metadata || {}) };
    delete explicitMetadata.__diagnosticSample;
    manifestSequence++;

    const entry = {
      sequence: manifestSequence,
      entryType: 'telemetry',
      recordedAt: recordedAt.toISOString(),
      reason: String(reason || 'page-event'),
      ...commonStateMetadata(executionState),
      ...selectTelemetryFields(current),
      telemetrySignatureHash: diagnosticSampleSignature(current),
      previousTelemetrySignatureHash: previous ? diagnosticSampleSignature(previous) : '',
      semanticTelemetryHash: currentSemanticHash,
      previousSemanticTelemetryHash: previousSemanticHash,
      semanticChangedSincePreviousTelemetry: previous ? currentSemanticHash !== previousSemanticHash : null,
      changedFields: changedTelemetryFields(previous, current),
      ...telemetryDeltas(previous, current),
      ...explicitMetadata
    };
    previousTelemetrySample = current;
    await appendManifest(entry).catch(() => {});
  }

  async function sendCaptureSnapshot() {
    if (!cdpSession) cdpSession = await createCdpSession();
    return withTimeout(
      cdpSession.send('Page.captureSnapshot', { format: 'mhtml' }),
      captureTimeoutMs,
      'Chromium MHTML capture timed out'
    );
  }

  async function captureSnapshotWithRecovery() {
    let attempts = 0;
    let cdpRecovered = false;
    let captureTimedOut = false;

    try {
      attempts++;
      return {
        snapshot: await sendCaptureSnapshot(),
        attempts,
        cdpRecovered,
        captureTimedOut
      };
    } catch (firstError) {
      captureTimedOut = firstError?.code === 'MHTML_CAPTURE_TIMEOUT';
      if (!recoverableCdpError(firstError)) throw Object.assign(firstError, { attempts, cdpRecovered, captureTimedOut });

      cdpRecovered = await recoverCdpSession();
      if (!cdpRecovered || captureTimedOut) {
        throw Object.assign(firstError, { attempts, cdpRecovered, captureTimedOut });
      }

      try {
        attempts++;
        return {
          snapshot: await sendCaptureSnapshot(),
          attempts,
          cdpRecovered,
          captureTimedOut
        };
      } catch (retryError) {
        captureTimedOut ||= retryError?.code === 'MHTML_CAPTURE_TIMEOUT';
        if (recoverableCdpError(retryError)) cdpRecovered = await recoverCdpSession() || cdpRecovered;
        throw Object.assign(retryError, { attempts, cdpRecovered, captureTimedOut });
      }
    }
  }

  async function captureOne(request) {
    const { reason, metadata, requestedAt, requestId, coalescedRequests, coalescedReasons } = request;
    snapshotSequence++;
    const filenameBase = [
      String(snapshotSequence).padStart(4, '0'),
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
      ? buildManifestMetadata(rawSample, previousMhtmlDiagnosticSample, {
          forceDetails: snapshotSequence === 1 || reason === 'manual-inspection-change'
        })
      : {};

    const captureStartedAt = new Date();
    let entry;
    try {
      const result = await captureSnapshotWithRecovery();
      const mhtml = String(result.snapshot?.data || '');
      await fs.writeFile(filePath, mhtml, 'utf8');
      const captureCompletedAt = new Date();
      manifestSequence++;
      entry = {
        sequence: manifestSequence,
        snapshotSequence,
        entryType: 'mhtml',
        requestId,
        requestedAt: requestedAt.toISOString(),
        captureStartedAt: captureStartedAt.toISOString(),
        captureCompletedAt: captureCompletedAt.toISOString(),
        capturedAt: captureCompletedAt.toISOString(),
        queueLatencyMs: Math.max(0, captureStartedAt.getTime() - requestedAt.getTime()),
        captureDurationMs: Math.max(0, captureCompletedAt.getTime() - captureStartedAt.getTime()),
        captureLatencyMs: Math.max(0, captureCompletedAt.getTime() - requestedAt.getTime()),
        elapsedSincePreviousCaptureMs: previousCapturedAt
          ? Math.max(0, captureCompletedAt.getTime() - previousCapturedAt.getTime())
          : null,
        captureAttempts: result.attempts,
        captureTimedOut: result.captureTimedOut,
        cdpRecovered: result.cdpRecovered,
        coalescedRequests: Number(coalescedRequests || 0),
        coalescedReasons: Array.isArray(coalescedReasons) ? coalescedReasons.slice(-20) : [],
        reason,
        ...commonStateMetadata(executionState),
        ...sampledMetadata,
        ...explicitMetadata,
        filename,
        bytes: Buffer.byteLength(mhtml, 'utf8'),
        ok: true
      };
      previousCapturedAt = captureCompletedAt;
    } catch (error) {
      const captureCompletedAt = new Date();
      manifestSequence++;
      entry = {
        sequence: manifestSequence,
        snapshotSequence,
        entryType: 'mhtml',
        requestId,
        requestedAt: requestedAt.toISOString(),
        captureStartedAt: captureStartedAt.toISOString(),
        captureCompletedAt: captureCompletedAt.toISOString(),
        capturedAt: captureCompletedAt.toISOString(),
        queueLatencyMs: Math.max(0, captureStartedAt.getTime() - requestedAt.getTime()),
        captureDurationMs: Math.max(0, captureCompletedAt.getTime() - captureStartedAt.getTime()),
        captureLatencyMs: Math.max(0, captureCompletedAt.getTime() - requestedAt.getTime()),
        elapsedSincePreviousCaptureMs: previousCapturedAt
          ? Math.max(0, captureCompletedAt.getTime() - previousCapturedAt.getTime())
          : null,
        captureAttempts: Number(error?.attempts || 1),
        captureTimedOut: Boolean(error?.captureTimedOut || error?.code === 'MHTML_CAPTURE_TIMEOUT'),
        cdpRecovered: Boolean(error?.cdpRecovered),
        coalescedRequests: Number(coalescedRequests || 0),
        coalescedReasons: Array.isArray(coalescedReasons) ? coalescedReasons.slice(-20) : [],
        reason,
        ...commonStateMetadata(executionState),
        ...sampledMetadata,
        ...explicitMetadata,
        filename,
        bytes: 0,
        ok: false,
        error: error?.message || String(error)
      };
      previousCapturedAt = captureCompletedAt;
    }

    if (rawSample) previousMhtmlDiagnosticSample = rawSample;
    await appendManifest(entry).catch(() => {});
  }

  async function drainCaptures() {
    while (!closed && pendingCapture) {
      const request = pendingCapture;
      pendingCapture = null;
      await captureOne(request);
    }
  }

  function queueMhtmlCapture(reason, metadata = {}, { force = false } = {}) {
    if (closed || (!acceptingCaptures && !force)) return drainPromise || Promise.resolve();

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

  /**
   * Backward-compatible capture entry point for explicit forensic checkpoints.
   * The two former high-frequency reasons are permanently redirected to JSONL
   * telemetry so callers cannot accidentally recreate material-DOM MHTML floods.
   */
  function capture(reason, metadata = {}) {
    const normalizedReason = String(reason || 'checkpoint');
    const sample = metadata?.__diagnosticSample || {};
    if (TELEMETRY_ONLY_CAPTURE_REASONS.has(normalizedReason)) {
      if (normalizedReason !== 'periodic-10s') idlePeriodic?.noteActivity();
      return recordTelemetry(normalizedReason, sample, metadata);
    }

    if (normalizedReason === 'context-closing') {
      acceptingCaptures = false;
      idlePeriodic?.stop();
      return queueMhtmlCapture(normalizedReason, metadata, { force: true });
    }
    return queueMhtmlCapture(normalizedReason, metadata);
  }

  idlePeriodic = createIdlePeriodicScheduler(() => {
    if (typeof idleCapture === 'function') {
      void Promise.resolve(idleCapture()).catch(() => {});
      return;
    }
    void capture('periodic-10s');
  });

  function startPeriodic(onIdle = null) {
    if (typeof onIdle === 'function') idleCapture = onIdle;
    idlePeriodic.start();
  }

  function noteActivity() {
    if (!acceptingCaptures || closed) return;
    idlePeriodic.noteActivity();
  }

  async function writeSummary() {
    runSummary.endedAt = new Date().toISOString();
    runSummary.captureRequestCount = Math.max(runSummary.captureRequestCount, requestNumber);
    if (runSummary.firstRetainedRevision == null) runSummary.firstRetainedRevision = 0;
    await fs.writeFile(summaryPath, `${JSON.stringify(runSummary, null, 2)}\n`, 'utf8');
  }

  async function close() {
    if (closed) return;
    acceptingCaptures = false;
    idlePeriodic.stop();
    await drainPromise?.catch(() => {});
    if (pendingCapture) {
      ensureDrain();
      await drainPromise?.catch(() => {});
    }
    closed = true;
    pendingCapture = null;
    await manifestWritePromise.catch(() => {});
    await writeSummary().catch(() => {});
    await detachCdpSession(cdpSession);
    cdpSession = null;
  }

  return {
    directory,
    manifestPath,
    summaryPath,
    capture,
    recordTelemetry,
    startPeriodic,
    noteActivity,
    close
  };
}
