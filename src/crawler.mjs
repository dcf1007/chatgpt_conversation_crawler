import {
  installCrawler,
  crawlConversation as crawlAutomaticConversation,
  CRAWLER_PROGRESS_LIMITS,
  __testing as crawlerTesting
} from './crawler-core.mjs';

const MANUAL_INSPECTION_ENV = 'CHATGPT_CRAWLER_MANUAL_INSPECTION';

export { installCrawler, CRAWLER_PROGRESS_LIMITS };

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
 * Run the exact beta11 automatic crawler first. The development package then
 * performs the independent two-step human comparison in the same authenticated
 * Chromium session. Manual work is diagnostic evidence, never a prerequisite
 * for beta11 automatic capture authority.
 */
export async function crawlConversation(page, options = {}) {
  const automaticResult = await crawlAutomaticConversation(page, options);

  if (process.env[MANUAL_INSPECTION_ENV] !== '1') return automaticResult;

  const { runManualInspection } = await import('./manual-inspection.mjs');
  const onDiagnosticProgress = patch => options.onProgress?.({
    ...patch,
    stage: 'diagnostic_validation'
  });

  try {
    await runManualInspection(page, {
      onProgress: onDiagnosticProgress,
      shouldCancel: options.shouldCancel,
      convergeMounted: async () => {
        // Human interaction can mount another nested generation. Reuse beta11's
        // existing turn-scoped fixed point and then offer the live turn back to
        // the same retention authority.
        await crawlerTesting.expandMounted(page, 500, options.onProgress, options.shouldCancel);
        await page.evaluate(() => window.__archiveCrawler.capture());
      }
    });
  } catch (error) {
    if (isCancellation(error, options.shouldCancel)) throw error;

    // Manual diagnostics are observational. A diagnostic-only failure must not
    // discard the already completed beta11 automatic capture or richer content
    // exposed before the failure.
    const message = String(error?.message || 'Manual inspection failed.');
    const stats = await retainPartialManualState(page);
    await onDiagnosticProgress({
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

  return automaticResult;
}

export const __testing = { ...crawlerTesting };
