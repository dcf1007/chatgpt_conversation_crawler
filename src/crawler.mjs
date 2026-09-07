import {
  installCrawler,
  crawlConversation as crawlBeta7Conversation,
  __testing as beta7Testing
} from './crawler-beta7-core.mjs';

const MANUAL_INSPECTION_ENV = 'CHATGPT_CRAWLER_MANUAL_INSPECTION';

export { installCrawler };

function isCancellation(error, shouldCancel) {
  return Boolean(
    shouldCancel?.()
    || error?.code === 'ARCHIVE_CANCELLED'
    || /archive cancelled/i.test(String(error?.message || ''))
  );
}

async function retainPartialManualState(page) {
  return page.evaluate(() => {
    const manual = window.__archiveManualInspection;
    manual?.observer?.disconnect?.();
    if (manual?.clickListener) document.removeEventListener('click', manual.clickListener, true);
    if (manual) {
      manual.active = false;
      manual.phase = 'manual-error-salvaged';
    }
    document.getElementById('archive-manual-inspection-panel')?.remove();
    document.getElementById('archive-manual-inspection-style')?.remove();
    window.__archiveCrawler?.capture?.();
    return window.__archiveCrawler?.stats?.() || {};
  }).catch(() => ({}));
}

/**
 * Run the beta7 fixed-point crawler first. In the development build, an
 * authenticated headed browser then pauses for a human inspection pass.
 *
 * Keeping manual inspection outside the beta7 core is deliberate: the core
 * remains the automatic algorithm we are evaluating, while the manual pass
 * gives us an independent before/after diagnostic.
 */
export async function crawlConversation(page, options = {}) {
  await crawlBeta7Conversation(page, options);

  if (process.env[MANUAL_INSPECTION_ENV] !== '1') return;

  const { runManualInspection } = await import('./manual-inspection.mjs');
  try {
    await runManualInspection(page, {
      onProgress: options.onProgress,
      shouldCancel: options.shouldCancel,
      convergeMounted: async () => {
        // After the user finishes, let beta7 expand anything newly revealed by
        // the manual clicks and require its normal fixed-point convergence.
        await beta7Testing.expandMounted(page, 500, options.onProgress, options.shouldCancel);
        await beta7Testing.stabilizeMounted(page, options.shouldCancel, 2400);
        await page.evaluate(() => window.__archiveCrawler.capture());
      }
    });
  } catch (error) {
    if (isCancellation(error, options.shouldCancel)) throw error;

    // The automatic beta7 crawl already completed before manual inspection.
    // A diagnostic-only failure must not discard that capture or any richer
    // DOM the user already revealed. Freeze the retained state and let the
    // normal server build a downloadable archive from everything captured up
    // to the failure point.
    const message = String(error?.message || 'Manual inspection failed.');
    const stats = await retainPartialManualState(page);
    await options.onProgress?.({
      ...stats,
      phase: 'Manual diagnostic incomplete — finalizing retained capture',
      detail: `${message} The automatic crawl and all retained manual content up to this point will still be finalized as a downloadable archive.`,
      scanningStatus: `Automatic crawl complete; manual diagnostic stopped early: ${message}`,
      scanComplete: true,
      pass: 0,
      direction: '',
      step: 0
    });
  }
}

// Preserve the existing beta7 test surface. Manual-inspection pure helpers are
// tested separately so this module can still be imported without Playwright's
// runtime dependencies being installed in the release syntax job.
export const __testing = { ...beta7Testing };
