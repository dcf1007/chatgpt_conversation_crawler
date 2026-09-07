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
  let periodicTimer = null;
  let closed = false;
  let captureQueue = Promise.resolve();

  async function appendManifest(entry) {
    await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function capture(reason, metadata = {}) {
    if (closed) return captureQueue;
    const requestedAt = new Date();

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

      const commonMetadata = {
        sequence: sequenceNumber,
        requestedAt: requestedAt.toISOString(),
        capturedAt: new Date().toISOString(),
        reason,
        sessionMode: diagnosticState.sessionMode,
        jobId: diagnosticState.id,
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
        scrollHeight: diagnosticState.scrollHeight || 0,
        preBlocks: diagnosticState.preBlocks || 0,
        codeBlocks: diagnosticState.codeBlocks || 0,
        appBlocks: diagnosticState.appBlocks || 0,
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

  function startPeriodic() {
    if (periodicTimer || closed) return;
    periodicTimer = setInterval(() => {
      void capture('periodic-10s');
    }, PERIODIC_CAPTURE_INTERVAL_MS);
    periodicTimer.unref?.();
  }

  async function close() {
    if (closed) return;
    if (periodicTimer) clearInterval(periodicTimer);
    periodicTimer = null;
    await captureQueue.catch(() => {});
    closed = true;
    await cdpSession.detach().catch(() => {});
  }

  return { directory, manifestPath, capture, startPeriodic, close };
}
