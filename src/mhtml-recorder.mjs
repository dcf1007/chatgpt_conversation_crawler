import fs from 'node:fs/promises';
import path from 'node:path';

const PERIODIC_CAPTURE_INTERVAL_MS = 10_000;

function sanitizeFilenamePart(value) {
  return String(value || 'snapshot')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'snapshot';
}

function timestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
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
    const manualScroll = window.__archiveManualScrollAssist || {};
    const foreground = window.__archiveForegroundProtection || {};
    const focusTelemetry = window.__archiveFocusTelemetry || {};
    return {
      visibilityState: document.visibilityState || '',
      documentHidden: Boolean(document.hidden),
      documentHasFocus: Boolean(document.hasFocus?.()),
      focusEmulation: Boolean(foreground.focusEmulation),
      idleOverride: Boolean(foreground.idleOverride),
      lifecycleActive: Boolean(foreground.lifecycleActive),
      pageActivated: Boolean(foreground.pageActivated),
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
      navigationDirectionResets: Number(navigation.directionResets || 0),
      manualScrollAssistActive: Boolean(manualScroll.active),
      manualScrollStagnantSteps: Number(manualScroll.stagnantSteps || 0),
      manualScrollLogicalProgress: manualScroll.lastLogicalProgress !== false,
      manualScrollRequestedTop: Number(manualScroll.lastRequestedTop || 0),
      manualScrollAppliedTop: Number(manualScroll.lastAppliedTop || 0),
      manualScrollMountedFirst: manualScroll.lastMountedFirst || '',
      manualScrollMountedLast: manualScroll.lastMountedLast || ''
    };
  }).catch(() => ({}));
}

/**
 * Capture Chromium's own MHTML serialization for a live page. Captures are
 * serialized through one promise chain so overlapping periodic/resource/DOM
 * triggers cannot issue Page.captureSnapshot concurrently.
 */
export async function createMhtmlRecorder(projectRoot, diagnosticState, page) {
  const directory = path.join(projectRoot, 'mhtml-diagnostics', diagnosticState.id);
  await fs.mkdir(directory, { recursive: true });

  const manifestPath = path.join(directory, 'manifest.jsonl');
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Page.enable').catch(() => {});

  let sequenceNumber = 0;
  let closed = false;
  let captureQueue = Promise.resolve();
  let idlePeriodic;

  async function appendManifest(entry) {
    await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function capture(reason, metadata = {}) {
    if (closed) return captureQueue;
    const requestedAt = new Date();

    // Event-driven captures provide better information than a blind clock tick.
    // Reset the idle timer so periodic MHTML is emitted only when there has
    // been no other capture request for a full interval.
    if (reason !== 'periodic-10s') idlePeriodic?.noteActivity();

    captureQueue = captureQueue.then(async () => {
      if (closed) return;

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

      const commonMetadata = {
        sequence: sequenceNumber,
        requestedAt: requestedAt.toISOString(),
        capturedAt: new Date().toISOString(),
        reason,
        sessionMode: diagnosticState.sessionMode,
        diagnosticId: diagnosticState.id,
        sourceUrl: diagnosticState.url,
        phase: diagnosticState.phase || '',
        pass: diagnosticState.pass || 0,
        direction: diagnosticState.direction || '',
        step: diagnosticState.step || 0,
        turns: diagnosticState.turns || 0,
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
        ...metadata
      };

      try {
        const snapshot = await cdpSession.send('Page.captureSnapshot', { format: 'mhtml' });
        const mhtml = String(snapshot?.data || '');
        await fs.writeFile(filePath, mhtml, 'utf8');
        await appendManifest({
          ...commonMetadata,
          filename,
          bytes: Buffer.byteLength(mhtml, 'utf8'),
          ok: true
        });
      } catch (error) {
        await appendManifest({
          ...commonMetadata,
          filename,
          bytes: 0,
          ok: false,
          error: error?.message || String(error)
        }).catch(() => {});
      }
    }).catch(() => {});

    return captureQueue;
  }

  idlePeriodic = createIdlePeriodicScheduler(() => {
    void capture('periodic-10s');
  });

  function startPeriodic() {
    idlePeriodic.start();
  }

  async function close() {
    if (closed) return;
    idlePeriodic.stop();
    await captureQueue.catch(() => {});
    closed = true;
    await cdpSession.detach().catch(() => {});
  }

  return { directory, manifestPath, capture, startPeriodic, close };
}
