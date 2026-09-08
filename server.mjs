import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './src/runtime-browser.mjs';
import { crawlConversation } from './src/crawler.mjs';
import { buildSnapshot } from './src/snapshot.mjs';
import {
  captureMountedAppBlocks,
  prepareEmbeddedContent,
  restoreEmbeddedContent,
  finalizeEmbeddedContent
} from './src/app-blocks.mjs';
import {
  installMainImageCapture,
  captureMountedMainImages,
  prepareMainImages,
  restoreMainImages,
  finalizeMainImages
} from './src/main-images.mjs';
import { createChatGptSessionManager } from './src/chatgpt-session.mjs';
import { finalizeConversationFidelity } from './src/archive-fidelity.mjs';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const root = path.dirname(fileURLToPath(import.meta.url));
const jobs = new Map();
const sessionManager = createChatGptSessionManager(root);
const PREVIEW_ACTIVE_MS = 10_000;
const PREVIEW_MIN_INTERVAL_MS = 20_000;
const PREVIEW_UNCHANGED_INTERVAL_MS = 45_000;

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(root, 'public')));

const now = () => Date.now();

function validateShareUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid URL.'); }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed.');
  if (!['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Only chatgpt.com share URLs are allowed.');
  }
  if (!url.pathname.startsWith('/share/')) throw new Error('Expected a ChatGPT conversation share URL under /share/.');
  url.hash = '';
  return url.toString();
}

function normalizeChatName(value) {
  let name = String(value || '').replace(/\s+/g, ' ').trim();
  name = name.replace(/\s+(?:[-–—|])\s+ChatGPT$/i, '').trim();
  if (!name || /^(?:ChatGPT|Check out this chat|Shared chat)$/i.test(name)) return '';
  return name.slice(0, 240).trim();
}

async function detectChatName(page) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const name = normalizeChatName(await page.title().catch(() => ''));
    if (name) return name;
    await page.waitForTimeout(250);
  }
  return '';
}

function safeFilenameBase(value, fallback) {
  let name = String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `${name}-chat`;
  if (!name) name = fallback;
  name = name.slice(0, 140).trim().replace(/[. ]+$/g, '');
  return name || fallback;
}

function contentDispositionFilename(chatName, id) {
  const fallbackBase = `chatgpt-share-${id.slice(0, 8)}`;
  const filename = `${safeFilenameBase(chatName, fallbackBase)}.html`;
  const ascii = filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename)
    .replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return { filename, header: `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}` };
}

function previewIsActive(job) {
  return Boolean(job.previewLastAccessAt && now() - job.previewLastAccessAt <= PREVIEW_ACTIVE_MS);
}

function loadedContentPosition(job) {
  const maximumTop = Math.max(1, (job.scrollHeight || 0) - (job.scrollClient || 0));
  return Math.max(0, Math.min(100, ((job.scrollTop || 0) / maximumTop) * 100));
}

function publicJob(job) {
  const positionInLoadedContent = loadedContentPosition(job);
  return {
    id: job.id,
    sessionMode: job.sessionMode || 'anonymous',
    chatName: job.chatName || '',
    downloadFilename: job.downloadFilename || '',
    status: job.state === 'complete' ? 'done' : job.state,
    phase: job.phase,
    detail: job.detail,
    scanningStatus: job.scanningStatus || 'Not started',
    oldestRetained: job.oldestRetained || 'none',
    oldestConverged: job.oldestConverged ?? null,
    oldestQuietChecks: job.oldestQuietChecks || 0,
    oldestChecks: job.oldestChecks || 0,
    expandingStatus: job.expandingStatus || 'No disclosure expansion yet',
    turns: job.turns || 0,
    seenMountedTurns: job.seenMountedTurns || 0,
    seenMountedUnretainedTurns: job.seenMountedUnretainedTurns || 0,
    seenMountedUnretainedTurnIds: Array.isArray(job.seenMountedUnretainedTurnIds)
      ? job.seenMountedUnretainedTurnIds
      : [],
    retainedUnresolvedTurns: job.retainedUnresolvedTurns || 0,
    retainedUnresolvedDisclosures: job.retainedUnresolvedDisclosures || 0,
    timelineMarkers: job.timelineMarkers || 0,
    appBlocks: job.appBlocks || 0,
    appBlockCaptureFailures: job.appBlockCaptureFailures || 0,
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
    reconciliationRounds: job.reconciliationRounds || 0,
    reconciliationStablePasses: job.reconciliationStablePasses || 0,
    diagnosticStep: job.diagnosticStep || 0,
    diagnosticSteps: job.diagnosticSteps || 0,
    waitingForUser: Boolean(job.waitingForUser),
    positionInLoadedContent,
    scrollPercent: positionInLoadedContent,
    scrollHeight: job.scrollHeight || 0,
    scrollClient: job.scrollClient || 0,
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

/**
 * "Last substantive progress" follows durable archive state. ChatGPT's
 * virtualizer may change mounted boundaries and scroll height without exposing
 * any new retained content; those transitions deliberately do not reset this
 * timestamp.
 */
function materialSignature(job, patch = {}) {
  return [
    patch.phase ?? job.phase,
    patch.turns ?? job.turns,
    patch.seenMountedTurns ?? job.seenMountedTurns,
    patch.seenMountedUnretainedTurns ?? job.seenMountedUnretainedTurns,
    patch.expanded ?? job.expanded,
    patch.failures ?? job.failures,
    patch.preBlocks ?? job.preBlocks,
    patch.codeBlocks ?? job.codeBlocks,
    patch.timelineMarkers ?? job.timelineMarkers,
    patch.appBlocks ?? job.appBlocks,
    patch.appBlockCaptureFailures ?? job.appBlockCaptureFailures,
    patch.imagesTotal ?? job.imagesTotal,
    patch.imagesEmbedded ?? job.imagesEmbedded,
    patch.imageEmbeddingFailures ?? job.imageEmbeddingFailures,
    patch.oldestRetained ?? job.oldestRetained,
    patch.newestRetained ?? job.newestRetained,
    patch.retainedUnresolvedTurns ?? job.retainedUnresolvedTurns,
    patch.retainedUnresolvedDisclosures ?? job.retainedUnresolvedDisclosures
  ].join('|');
}

function previewSignature(job) {
  return [
    job.turns,
    job.seenMountedTurns,
    job.seenMountedUnretainedTurns,
    job.timelineMarkers,
    job.appBlocks,
    job.appBlockCaptureFailures,
    job.expanded,
    job.failures,
    job.preBlocks,
    job.codeBlocks,
    job.oldestRetained,
    job.newestRetained
  ].join('|');
}

async function assembleSnapshot(page, sourceUrl, options = {}) {
  const mainImages = options.embedImages === false ? null : await prepareMainImages(page);
  const prepared = await prepareEmbeddedContent(page, { embedSvgImages: options.embedImages !== false });
  let snapshot;
  try {
    snapshot = await buildSnapshot(page, sourceUrl, options);
  } finally {
    await restoreEmbeddedContent(page, prepared);
    if (mainImages) await restoreMainImages(page, mainImages);
  }
  snapshot = finalizeEmbeddedContent(snapshot, prepared);
  if (mainImages) snapshot = finalizeMainImages(snapshot, mainImages);
  return finalizeConversationFidelity(snapshot);
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
      const snapshot = await assembleSnapshot(job.page, job.url, { preview: true, embedImages: false });
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

async function launchJobBrowser(job) {
  if (job.sessionMode === 'authenticated') {
    update(job, {
      phase: 'Opening saved ChatGPT session',
      detail: 'Waiting for exclusive access to ./browser-profile.',
      scanningStatus: 'Not started'
    });
    const handle = await sessionManager.openAuthenticatedContext(`archive ${job.id.slice(0, 8)}`, {
      shouldCancel: () => job.cancelRequested,
      onWait: owner => update(job, {
        phase: 'Waiting for saved ChatGPT session',
        detail: `The persistent browser profile is currently in use by ${owner}. This archive will start when it is released.`
      }, false)
    });
    job.authenticatedHandle = handle;
    job.context = handle.context;
    job.page = handle.page;
    return;
  }

  update(job, {
    phase: 'Launching Chromium',
    detail: 'Starting a clean anonymous headless browser.',
    scanningStatus: 'Not started'
  });
  job.browser = await chromium.launch({ headless: true });
  job.context = await job.browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true });
  job.page = await job.context.newPage();
}

async function runJob(job) {
  const heartbeat = setInterval(() => { job.heartbeatAt = now(); }, 2000);
  heartbeat.unref?.();

  try {
    await launchJobBrowser(job);
    assertNotCancelled(job);
    installMainImageCapture(job.page);

    update(job, {
      state: 'running',
      phase: 'Loading share',
      detail: job.sessionMode === 'authenticated'
        ? 'Opening the ChatGPT share page with the saved browser profile.'
        : 'Opening the ChatGPT share page in an anonymous browser.',
      scanningStatus: 'Not started'
    });
    await job.page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await job.page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await captureMountedMainImages(job.page).catch(() => {});
    assertNotCancelled(job);

    if (job.sessionMode === 'authenticated') {
      const auth = await sessionManager.probePage(job.page);
      if (auth.authenticated === false) {
        const error = new Error('The saved ChatGPT session is not authenticated. Open the ChatGPT login window, sign in, close the window, and try the authenticated archive again.');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }
      if (auth.authenticated === null) {
        update(job, {
          detail: `The saved profile is being used, but ChatGPT session verification was inconclusive (${auth.detail}). Continuing with the page content exposed to this profile.`
        }, true);
      }
    }

    const bodyText = (await job.page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    if (/page not found|conversation not found|link.*(expired|deleted)|access denied/i.test(bodyText)) {
      throw new Error('The shared conversation could not be accessed. The link may be invalid, deleted, or restricted.');
    }

    const detectedChatName = await detectChatName(job.page);
    if (detectedChatName) {
      const { filename } = contentDispositionFilename(detectedChatName, job.id);
      update(job, { chatName: detectedChatName, downloadFilename: filename }, true);
    }

    job.materialSignature = '';
    const onProgress = async patch => {
      let nextPatch = patch;
      const fullCheckpoint = Object.prototype.hasOwnProperty.call(patch || {}, 'scrollHeight')
        || patch?.scanComplete === true;
      if (fullCheckpoint) {
        await captureMountedMainImages(job.page).catch(() => {});
        const appState = await captureMountedAppBlocks(job.page).catch(() => null);
        if (appState) {
          nextPatch = {
            ...patch,
            appBlocks: appState.captured,
            appBlockCaptureFailures: appState.failures
          };
        }
      }

      const signature = materialSignature(job, nextPatch);
      const substantive = signature !== job.materialSignature;
      update(job, nextPatch, substantive);
      job.maxObservedScrollHeight = Math.max(job.maxObservedScrollHeight || 0, Number(nextPatch.scrollHeight || 0));
      job.materialSignature = signature;
      await maybeRefreshPreview(job);
    };

    await crawlConversation(job.page, { onProgress, shouldCancel: () => job.cancelRequested });
    assertNotCancelled(job);

    await captureMountedMainImages(job.page, { settleMs: 1500 }).catch(() => {});
    await captureMountedAppBlocks(job.page).catch(() => {});
    update(job, {
      phase: 'Building final static page',
      detail: 'Sanitizing retained turns, formulas, SVG, app-block frames, embedding retrievable images, and assembling the downloadable HTML archive.',
      waitingForUser: false,
      scanComplete: true,
      pass: 0,
      direction: '',
      step: 0
    });

    const snapshot = await assembleSnapshot(job.page, job.url, { preview: false, embedImages: true });
    assertNotCancelled(job);
    if (!snapshot.stats.turns) {
      throw new Error('No conversation turns were captured. ChatGPT may have changed the shared-page DOM.');
    }

    job.html = snapshot.html;
    job.previewHtml = snapshot.html;
    job.previewVersion++;
    update(job, {
      ...snapshot.stats,
      state: 'complete',
      phase: 'Complete',
      detail: 'Static HTML is ready to download.',
      waitingForUser: false,
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
      waitingForUser: false,
      finishedAt: now()
    });
  } finally {
    clearInterval(heartbeat);
    if (job.authenticatedHandle) {
      await job.authenticatedHandle.close().catch(() => {});
    } else {
      await job.context?.close().catch(() => {});
      await job.browser?.close().catch(() => {});
    }
    job.authenticatedHandle = null;
    job.context = null;
    job.browser = null;
    job.page = null;
  }
}

function sessionErrorStatus(error) {
  return error?.code === 'PROFILE_BUSY' ? 409 : 500;
}

app.get('/api/session/status', async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.json(await sessionManager.status());
});

app.post('/api/session/login', async (request, response) => {
  try {
    response.status(202).json(await sessionManager.openLoginWindow());
  } catch (error) {
    response.status(sessionErrorStatus(error)).json({ error: error?.message || 'Could not open the ChatGPT login window.' });
  }
});

app.post('/api/session/close-login', async (request, response) => {
  try {
    response.json(await sessionManager.closeLoginWindow());
  } catch (error) {
    response.status(sessionErrorStatus(error)).json({ error: error?.message || 'Could not close the ChatGPT login window.' });
  }
});

app.post('/api/session/check', async (request, response) => {
  try {
    response.json(await sessionManager.checkSession());
  } catch (error) {
    response.status(sessionErrorStatus(error)).json({ error: error?.message || 'Could not check the saved ChatGPT session.' });
  }
});

app.post('/api/session/forget', async (request, response) => {
  try {
    response.json(await sessionManager.forgetProfile());
  } catch (error) {
    response.status(sessionErrorStatus(error)).json({ error: error?.message || 'Could not delete the saved ChatGPT browser profile.' });
  }
});

app.post('/api/archive/start', async (request, response) => {
  try {
    const url = validateShareUrl(request.body?.url);
    const sessionMode = request.body?.sessionMode === 'anonymous' ? 'anonymous' : 'authenticated';
    if (sessionMode === 'authenticated') {
      const session = await sessionManager.status();
      if (!session.profileExists) {
        return response.status(409).json({
          error: 'No saved ChatGPT browser profile exists yet. Open the ChatGPT login window and sign in first.'
        });
      }
    }

    const id = crypto.randomUUID();
    const timestamp = now();
    const job = {
      id,
      url,
      sessionMode,
      chatName: '',
      downloadFilename: `chatgpt-share-${id.slice(0, 8)}.html`,
      state: 'queued',
      phase: 'Queued',
      detail: sessionMode === 'authenticated'
        ? 'Waiting to use the saved ChatGPT browser profile.'
        : 'Waiting to start an anonymous browser.',
      scanningStatus: 'Not started',
      oldestRetained: 'none',
      newestRetained: 'none',
      mountedFirst: 'none',
      mountedLast: 'none',
      oldestConverged: null,
      oldestQuietChecks: 0,
      oldestChecks: 0,
      expandingStatus: 'No disclosure expansion yet',
      scanComplete: false,
      createdAt: timestamp,
      heartbeatAt: timestamp,
      progressAt: timestamp,
      finishedAt: null,
      turns: 0,
      seenMountedTurns: 0,
      seenMountedUnretainedTurns: 0,
      seenMountedUnretainedTurnIds: [],
      retainedUnresolvedTurns: 0,
      retainedUnresolvedDisclosures: 0,
      timelineMarkers: 0,
      appBlocks: 0,
      appBlockCaptureFailures: 0,
      expanded: 0,
      clicks: 0,
      failures: 0,
      preBlocks: 0,
      codeBlocks: 0,
      imagesTotal: 0,
      imagesEmbedded: 0,
      imageEmbeddingFailures: 0,
      pass: 0,
      direction: '',
      step: 0,
      reconciliationRounds: 0,
      reconciliationStablePasses: 0,
      diagnosticStep: 0,
      diagnosticSteps: 0,
      waitingForUser: false,
      scrollTop: 0,
      scrollHeight: 0,
      scrollClient: 0,
      previewVersion: 0,
      previewHtml: '',
      previewPaused: false,
      previewLastAccessAt: 0,
      previewBuiltAt: 0,
      previewSignature: '',
      previewBuildPromise: null,
      html: '',
      error: '',
      cancelRequested: false,
      browser: null,
      context: null,
      authenticatedHandle: null,
      page: null,
      materialSignature: '',
      maxObservedScrollHeight: 0
    };
    jobs.set(id, job);
    setImmediate(() => runJob(job));
    response.status(202).json({ jobId: id });
  } catch (error) {
    response.status(400).json({ error: error?.message || 'Could not start archive.' });
  }
});

app.get('/api/archive/status/:id', (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: 'Job not found or expired.' });
  if (request.query.preview === '1') {
    job.previewLastAccessAt = now();
    void maybeRefreshPreview(job, { force: !job.previewHtml }).catch(() => {});
  }
  response.setHeader('Cache-Control', 'no-store');
  response.json(publicJob(job));
});

app.get('/api/archive/preview/:id', (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).send('Job not found or expired.');
  job.previewLastAccessAt = now();
  response.setHeader('Cache-Control', 'no-store');
  if (!job.previewHtml) return response.status(204).end();
  response.type('html').send(job.previewHtml);
});

app.get('/api/archive/download/:id', (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: 'Job not found or expired.' });
  if (job.state !== 'complete' || !job.html) {
    return response.status(409).json({ error: 'Archive is not complete yet.' });
  }
  const disposition = contentDispositionFilename(job.chatName, job.id);
  job.downloadFilename = disposition.filename;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Content-Disposition', disposition.header);
  response.setHeader('Cache-Control', 'no-store');
  response.send(job.html);
});

app.post('/api/archive/cancel/:id', async (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) return response.status(404).json({ error: 'Job not found or expired.' });
  if (['complete', 'error', 'cancelled'].includes(job.state)) return response.json(publicJob(job));
  job.cancelRequested = true;
  update(job, { detail: 'Cancellation requested; stopping Chromium…', waitingForUser: false }, true);
  await job.context?.close().catch(() => {});
  await job.browser?.close().catch(() => {});
  response.json(publicJob(job));
});

setInterval(() => {
  const cutoff = now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

app.listen(PORT, HOST, () => console.log(`ChatGPT Conversation Crawler: http://${HOST}:${PORT}`));
