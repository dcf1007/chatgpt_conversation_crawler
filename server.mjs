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

function publicJob(job) {
  const max = Math.max(1, (job.scrollHeight || 0) - (job.scrollClient || 0));
  const scrollPercent = Math.max(0, Math.min(100, ((job.scrollTop || 0) / max) * 100));
  return {
    id: job.id,
    status: job.state === 'complete' ? 'done' : job.state,
    phase: job.phase,
    detail: job.detail,
    scanningStatus: job.scanningStatus || 'Not scanning yet',
    oldestRetained: job.oldestRetained || 'none',
    expandingStatus: job.expandingStatus || 'No disclosure expansion yet',
    turns: job.turns || 0,
    expansions: job.expanded || 0,
    clicks: job.clicks || 0,
    failures: job.failures || 0,
    preBlocks: job.preBlocks || 0,
    codeBlocks: job.codeBlocks || 0,
    heartbeatAt: job.heartbeatAt,
    lastProgressAt: job.progressAt,
    scanPass: job.pass || 0,
    scanPasses: 3,
    direction: job.direction || '',
    step: job.step || 0,
    scrollPercent,
    previewReady: Boolean(job.previewHtml),
    error: job.error || ''
  };
}

function update(job, patch = {}, substantive = true) {
  Object.assign(job, patch, { heartbeatAt: now() });
  if (substantive) job.progressAt = now();
}

async function runJob(job) {
  try {
    update(job, {
      state: 'running',
      phase: 'Launching Chromium',
      detail: 'Starting a clean headless browser',
      scanningStatus: 'Waiting for page load'
    });
    job.browser = await chromium.launch({ headless: true });
    const context = await job.browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true });
    job.page = await context.newPage();

    update(job, {
      phase: 'Loading share',
      detail: 'Opening the ChatGPT share page',
      scanningStatus: 'Waiting for ChatGPT to render'
    });
    await job.page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await job.page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});

    const text = (await job.page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    if (/page not found|conversation not found|link.*(expired|deleted)|access denied/i.test(text)) {
      throw new Error('The shared conversation could not be accessed. The link may be invalid, deleted, or restricted.');
    }

    let lastPreview = 0;
    let lastSignature = '';
    const onProgress = async p => {
      const signature = [
        p.phase,
        p.detail,
        p.scanningStatus,
        p.oldestRetained,
        p.expandingStatus,
        p.turns,
        p.expanded,
        p.failures,
        p.preBlocks,
        p.codeBlocks
      ].join('|');
      update(job, p, signature !== lastSignature);
      lastSignature = signature;

      if (!job.previewPaused && now() - lastPreview > 3000 && p.turns) {
        lastPreview = now();
        const snap = await buildSnapshot(job.page, job.url);
        job.previewHtml = snap.html;
        job.previewVersion++;
        job.heartbeatAt = now();
      }
    };

    await crawlConversation(job.page, { onProgress, shouldCancel: () => job.cancelRequested });

    update(job, {
      phase: 'Building final static page',
      detail: 'Sanitizing captured turns and assembling HTML',
      scanningStatus: 'Scanning complete'
    });
    const snapshot = await buildSnapshot(job.page, job.url);
    if (!snapshot.stats.turns) throw new Error('No conversation turns were captured. ChatGPT may have changed the shared-page DOM.');

    job.html = snapshot.html;
    job.previewHtml = snapshot.html;
    job.previewVersion++;
    update(job, {
      ...snapshot.stats,
      state: 'complete',
      phase: 'Complete',
      detail: 'Static HTML is ready to download',
      scanningStatus: 'Complete',
      finishedAt: now()
    });
  } catch (e) {
    update(job, {
      state: job.cancelRequested ? 'cancelled' : 'error',
      phase: job.cancelRequested ? 'Cancelled' : 'Error',
      detail: e?.message || 'Archive failed.',
      error: e?.message || 'Archive failed.',
      finishedAt: now()
    });
  } finally {
    await job.browser?.close().catch(() => {});
    job.browser = null;
    job.page = null;
  }
}

app.post('/api/archive/start', (req, res) => {
  try {
    const url = validateShareUrl(req.body?.url);
    const id = crypto.randomUUID();
    const job = {
      id,
      url,
      state: 'queued',
      phase: 'Queued',
      detail: 'Waiting to start',
      scanningStatus: 'Not scanning yet',
      oldestRetained: 'none',
      expandingStatus: 'No disclosure expansion yet',
      createdAt: now(),
      heartbeatAt: now(),
      progressAt: now(),
      finishedAt: null,
      turns: 0,
      expanded: 0,
      clicks: 0,
      failures: 0,
      preBlocks: 0,
      codeBlocks: 0,
      pass: 0,
      direction: '',
      step: 0,
      scrollTop: 0,
      scrollHeight: 0,
      scrollClient: 0,
      previewVersion: 0,
      previewHtml: '',
      html: '',
      error: '',
      cancelRequested: false,
      previewPaused: false,
      browser: null,
      page: null
    };
    jobs.set(id, job);
    runJob(job);
    res.json({ jobId: id });
  } catch (e) {
    res.status(400).json({ error: e?.message || 'Could not start archive.' });
  }
});

app.get('/api/archive/status/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicJob(j));
});

app.get('/api/archive/preview/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).send('Job not found.');
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(j.previewHtml || '<!doctype html><meta charset="utf-8"><title>Preview</title><p>Waiting for the first captured turns…</p>');
});

app.get('/api/archive/download/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  if (j.state !== 'complete' || !j.html) return res.status(409).json({ error: 'Archive is not complete yet.' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chatgpt-share-${j.id.slice(0, 8)}.html"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(j.html);
});

app.post('/api/archive/cancel/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  j.cancelRequested = true;
  update(j, { detail: 'Cancellation requested…' });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`ChatGPT Share Archiver: http://localhost:${PORT}`));
