import {
  installCrawler,
  crawlConversation as crawlAutomaticConversation,
  __testing as crawlerTesting
} from './crawler-core.mjs';

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
 * Run the automatic crawler first. Development builds then run the independent
 * two-step human comparison in the same authenticated Chromium session. The
 * manual pass remains outside automatic capture authority: it validates the
 * automatic result rather than contributing required content to it.
 */
export async function crawlConversation(page, options = {}) {
  await crawlAutomaticConversation(page, options);

  if (process.env[MANUAL_INSPECTION_ENV] !== '1') return;

  const { runManualInspection } = await import('./manual-inspection.mjs');
  try {
    await runManualInspection(page, {
      onProgress: options.onProgress,
      shouldCancel: options.shouldCancel,
      convergeMounted: async () => {
        // Human interaction can mount a fresh nested generation. Reuse the
        // turn-scoped fixed point, then retain the resulting live DOM.
        await crawlerTesting.expandMounted(page, 500, options.onProgress, options.shouldCancel);
        await page.evaluate(() => window.__archiveCrawler.capture());
      }
    });
  } catch (error) {
    if (isCancellation(error, options.shouldCancel)) throw error;

    // Manual diagnostics are observational. A diagnostic-only failure must not
    // discard the completed automatic capture or richer content exposed before
    // the failure.
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

export const __testing = { ...crawlerTesting };
