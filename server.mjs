import express from 'express';
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlConversation } from './src/crawler.mjs';
import { buildSnapshot } from './src/snapshot.mjs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));
const jobs = new Map();
const PREVIEW_ACTIVE_MS = 10_000;
const PREVIEW_MIN_INTERVAL_MS = 20_000;
const PREVIEW_UNCHANGED_INTERVAL_MS = 45_000;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(root, 'public')));

const now = () => Date.now();

function validateShareUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new Error('Enter a valid URL.'); }
  if (u.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed.');
  if (!['chatgpt.com', 'www.chatgpt.com'].includes(u.hostname.toLowerCase())) throw new Error('Only chatgpt.com share URLs are allowed.');
  if (!u.pathname.startsWith('/share/')) throw new Error('Expected a ChatGPT conversation share URL under /share/.');
  u.hash = '';
  return u.toString();
}

function previewIsActive(job) {
  return Boolean(job.previewLastAccessAt && now() - job.previewLastAccessAt <= PREVIEW_ACTIVE_MS);
}

function publicJob(job) {
  const max = Math.max(1, (job.scrollHeight || 0) - (job.scrollClient || 0));
  const scrollPercent = Math.max(0, Math.min(100, ((job.scrollTop || 0) / max) * 100));
  return {
    id: job.id,
    status: job.state === 'complete' ? 'done' : job.state,
    phase: job.phase,
    detail: job.detail,
    scanningStatus: job.scanningStatus || 'Not started',
    oldestRetained: job.oldestRetained || 'none',
    mountedFirst: job.mountedFirst || 'none',
    mountedLast: job.mountedLast || 'none',
    oldestConverged: job.oldestConverged ?? null,
    oldestQuietChecks: job.oldestQuietChecks || 0,
    oldestChecks: job.oldestChecks || 0,
    expandingStatus: job.expandingStatus || 'No disclosure expansion yet',
    turns: job.turns || 0,
    expansions: job.expanded || 0,
    clicks: job.clicks || 0,
    failures: job.failures || 0,
    preBlocks: job.preBlocks || 0,
    codeBlocks: job.codeBlocks || 0,
    imagesTotal: job.imagesTotal || 0,
    imagesEmbedded: job.imagesEmbedded || 0,
    imageEmbeddingFailures: job.imageEmbeddingFailures || 0,
    heartbeatAt: job.heartbeatAt,
    lastProgressAt: job.progressAt,
    scanPass: job.pass || 0,
    scanPasses: 3,
    scanComplete: Boolean(job.scanComplete),
    direction: job.direction || '',
    step: job.step || 0,
    scrollPercent,
    previewReady: Boolean(job.previewHtml),
    previewVersion: job.previewVersion || 0,
    previewActive: previewIsActive(job),
    error: job.error || ''
  };
}

function update(job, patch = {}, substantive = true) {
  Object.assign(job, patch);
  if (substantive) job.progressAt = now();
}

function assertNotCancelled(job) {
  if (!job.cancelRequested) return;
  const error = new Error('Archive cancelled.');
  error.code = 'ARCHIVE_CANCELLED';
  throw error;
}

function materialSignature(job, patch = {}, maxObservedScrollHeight = job.maxObservedScrollHeight || 0) {
  return [
    patch.phase ?? job.phase,
    patch.turns ?? job.turns,
    patch.expanded ?? job.expanded,
    patch.failures ?? job.failures,
    patch.preBlocks ?? job.preBlocks,
    patch.codeBlocks ?? job.codeBlocks,
    patch.oldestRetained ?? job.oldestRetained,
    patch.newestRetained ?? job.newestRetained,
    patch.mountedFirst ?? job.mountedFirst,
    patch.mountedLast ?? job.mountedLast,
    Math.round(maxObservedScrollHeight)
  ].join('|');
}

function previewSignature(job) {
  return [job.turns, job.expanded, job.failures, job.preBlocks, job.codeBlocks, job.oldestRetained, job.newestRetained, job.mountedFirst, job.mountedLast].join('|');
}

async function maybeRefreshPreview(job, { force = false } = {}) {
  if (!job.page || job.previewPaused || !previewIsActive(job) || job.cancelRequested) return;
  if (job.previewBuildPromise) return job.previewBuildPromise;

  const elapsed = now() - (job.previewBuiltAt || 0);
  const signature = previewSignature(job);
  if (!force && elapsed < PREVIEW_MIN_INTERVAL_MS) return;
  if (!force && signature === job.previewSignature && elapsed < PREVIEW_UNCHANGED_INTERVAL_MS) return;

  job.previewBuildPromise = (async () => {
    try {
      const snapshot = await buildSnapshot(job.page, job.url, { preview: true, embedImages: false });
      if (job.cancelRequested) return;
      job.previewHtml = snapshot.html;
      job.previewVersion++;
      job.previewBuiltAt = now();
      job.previewSignature = signature;
    } finally {
      job.previewBuildPromise = null;
    }
  })();
  return job.previewBuildPromise;
}

async function runJob(job) {
  const heartbeat = setInterval(() => { job.heartbeatAt = now(); }, 2000);
  heartbeat.unref?.();
  try {
    update(job, {
      state: 'running',
      phase: 'Launching Chromium',
      detail: 'Starting a clean headless browser.',
      scanningStatus: 'Not started'
    });
    job.browser = await chromium.launch({ headless: true });
    const context = await job.browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true });
    job.page = await context.newPage();

    update(job, {
      phase: 'Loading share',
      detail: 'Opening the ChatGPT share page and waiting for its initial render.',
      scanningStatus: 'Not started'
    });
    await job.page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await job.page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    assertNotCancelled(job);

    const text = (await job.page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    if (/page not found|conversation not found|link.*(expired|deleted)|access denied/i.test(text)) {
      throw new Error('The shared conversation could not be accessed. The link may be invalid, deleted, or restricted.');
    }

    job.materialSignature = '';
    const onProgress = async patch => {
      const maxObservedScrollHeight = Math.max(job.maxObservedScrollHeight || 0, Number(patch.scrollHeight || 0));
      const signature = materialSignature(job, patch, maxObservedScrollHeight);
      const substantive = signature !== job.materialSignature;
      update(job, patch, substantive);
      job.maxObservedScrollHeight = maxObservedScrollHeight;
      job.materialSignature = signature;
      await maybeRefreshPreview(job);
    };

    await crawlConversation(job.page, { onProgress, shouldCancel: () => job.cancelRequested });
    assertNotCancelled(job);

    update(job, {
      phase: 'Building final static page',
      detail: 'Sanitizing retained turns, embedding retrievable images, and assembling the downloadable HTML archive.',
      scanningStatus: job.scanningStatus || (job.oldestConverged === false ? 'Complete — 3 passes; oldest-edge safety limit reached' : 'Complete — 3 passes + oldest-edge convergence'),
      scanComplete: true,
      pass: 0,
      direction: '',
      step: 0
    });

    const snapshot = await buildSnapshot(job.page, job.url, { preview: false, embedImages: true });
    assertNotCancelled(job);
    if (!snapshot.stats.turns) throw new Error('No conversation turns were captured. ChatGPT may have changed the shared-page DOM.');

    job.html = snapshot.html;
    job.previewHtml = snapshot.html;
    job.previewVersion++;
    update(job, {
      ...snapshot.stats,
      state: 'complete',
      phase: 'Complete',
      detail: 'Static HTML is ready to download.',
      scanningStatus: job.scanningStatus || (job.oldestConverged === false ? 'Complete — 3 passes; oldest-edge safety limit reached' : 'Complete — 3 passes + oldest-edge convergence'),
      scanComplete: true,
      pass: 0,
      direction: '',
      step: 0,
      finishedAt: now()
    });
  } catch (error) {
    const cancelled = job.cancelRequested || error?.code === 'ARCHIVE_CANCELLED';
    update(job, {
      state: cancelled ? 'cancelled' : 'error',
      phase: cancelled ? 'Cancelled' : 'Error',
      detail: cancelled ? 'The archive job was cancelled.' : (error?.message || 'Archive failed.'),
      error: cancelled ? '' : (error?.message || 'Archive failed.'),
      finishedAt: now()
    });
  } finally {
    clearInterval(heartbeat);
    await job.browser?.close().catch(() => {});
    job.browser = null;
    job.page = null;
  }
}

app.post('/api/archive/start', (req, res) => {
  try {
    const url = validateShareUrl(req.body?.url);
    const id = crypto.randomUUID();
    const t = now();
    const job = {
      id, url,
      state: 'queued',
      phase: 'Queued',
      detail: 'Waiting to start.',
      scanningStatus: 'Not started',
      oldestRetained: 'none', newestRetained: 'none', mountedFirst: 'none', mountedLast: 'none',
      oldestConverged: null, oldestQuietChecks: 0, oldestChecks: 0,
      expandingStatus: 'No disclosure expansion yet',
      scanComplete: false,
      createdAt: t, heartbeatAt: t, progressAt: t, finishedAt: null,
      turns: 0, expanded: 0, clicks: 0, failures: 0, preBlocks: 0, codeBlocks: 0,
      imagesTotal: 0, imagesEmbedded: 0, imageEmbeddingFailures: 0,
      pass: 0, direction: '', step: 0, scrollTop: 0, scrollHeight: 0, scrollClient: 0,
      previewVersion: 0, previewHtml: '', previewPaused: false, previewLastAccessAt: 0,
      previewBuiltAt: 0, previewSignature: '', previewBuildPromise: null,
      html: '', error: '', cancelRequested: false, browser: null, page: null, materialSignature: '', maxObservedScrollHeight: 0
    };
    jobs.set(id, job);
    setImmediate(() => runJob(job));
    res.status(202).json({ jobId: id });
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not start archive.' });
  }
});

app.get('/api/archive/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (req.query.preview === '1') {
    job.previewLastAccessAt = now();
    void maybeRefreshPreview(job, { force: !job.previewHtml }).catch(() => {});
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicJob(job));
});

app.get('/api/archive/preview/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('Job not found or expired.');
  job.previewLastAccessAt = now();
  res.setHeader('Cache-Control', 'no-store');
  if (!job.previewHtml) return res.status(204).end();
  res.type('html').send(job.previewHtml);
});

app.get('/api/archive/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (job.state !== 'complete' || !job.html) return res.status(409).json({ error: 'Archive is not complete yet.' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chatgpt-share-${job.id.slice(0, 8)}.html"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(job.html);
});

app.post('/api/archive/cancel/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  if (['complete','error','cancelled'].includes(job.state)) return res.json(publicJob(job));
  job.cancelRequested = true;
  update(job, { detail: 'Cancellation requested; stopping Chromium…' }, true);
  await job.browser?.close().catch(() => {});
  res.json(publicJob(job));
});

setInterval(() => {
  const cutoff = now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

app.listen(PORT, () => console.log(`ChatGPT Conversation Crawler: http://localhost:${PORT}`));
