import fs from 'node:fs/promises';
import path from 'node:path';

const PERIODIC_MS = 10_000;

function safePart(value) {
  return String(value || 'snapshot')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'snapshot';
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function createMhtmlRecorder(root, job, page) {
  const directory = path.join(root, 'mhtml-diagnostics', job.id);
  await fs.mkdir(directory, { recursive: true });
  const manifestPath = path.join(directory, 'manifest.jsonl');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.enable').catch(() => {});

  let sequence = 0;
  let timer = null;
  let closed = false;
  let queue = Promise.resolve();

  async function appendManifest(entry) {
    await fs.appendFile(manifestPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function capture(reason, meta = {}) {
    if (closed) return queue;
    const requestedAt = new Date();
    queue = queue.then(async () => {
      if (closed) return;
      const n = ++sequence;
      const base = `${String(n).padStart(4, '0')}-${stamp(requestedAt)}-${safePart(job.sessionMode)}-${safePart(reason)}`;
      const filename = `${base}.mhtml`;
      const filepath = path.join(directory, filename);
      const common = {
        sequence: n,
        requestedAt: requestedAt.toISOString(),
        capturedAt: new Date().toISOString(),
        reason,
        sessionMode: job.sessionMode,
        jobId: job.id,
        sourceUrl: job.url,
        phase: job.phase || '',
        pass: job.pass || 0,
        direction: job.direction || '',
        step: job.step || 0,
        turns: job.turns || 0,
        oldestRetained: job.oldestRetained || 'none',
        newestRetained: job.newestRetained || 'none',
        mountedFirst: job.mountedFirst || 'none',
        mountedLast: job.mountedLast || 'none',
        scrollHeight: job.scrollHeight || 0,
        preBlocks: job.preBlocks || 0,
        codeBlocks: job.codeBlocks || 0,
        appBlocks: job.appBlocks || 0,
        ...meta
      };

      try {
        const result = await cdp.send('Page.captureSnapshot', { format: 'mhtml' });
        const data = String(result?.data || '');
        await fs.writeFile(filepath, data, 'utf8');
        await appendManifest({ ...common, filename, bytes: Buffer.byteLength(data, 'utf8'), ok: true });
      } catch (error) {
        await appendManifest({ ...common, filename, bytes: 0, ok: false, error: error?.message || String(error) }).catch(() => {});
      }
    }).catch(() => {});
    return queue;
  }

  function startPeriodic() {
    if (timer || closed) return;
    timer = setInterval(() => { void capture('periodic-10s'); }, PERIODIC_MS);
    timer.unref?.();
  }

  async function close() {
    if (closed) return;
    if (timer) clearInterval(timer);
    timer = null;
    await queue.catch(() => {});
    closed = true;
    await cdp.detach().catch(() => {});
  }

  return { directory, manifestPath, capture, startPeriodic, close };
}
