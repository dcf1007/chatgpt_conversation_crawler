import {
  installCrawler,
  crawlConversation as crawlAutomaticConversation,
  CRAWLER_PROGRESS_LIMITS,
  __testing as crawlerTesting
} from './crawler-core.mjs';
import { installPageForegroundProtection } from './runtime-browser.mjs';

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
 * Run the automatic crawler first. Beta14-dev adds foreground-focus emulation
 * before traversal so backgrounded authenticated capture does not depend on an
 * OS-window focus event. The development package then performs the independent
 * two-step human comparison in the same authenticated Chromium session.
 */
export async function crawlConversation(page, options = {}) {
  // Chromium launch flags already disable renderer/timer backgrounding. The
  // beta13.1 run still resumed when the OS window gained focus, so beta14-dev
  // also enables CDP focus emulation on the actual capture page. Keep failure
  // non-fatal so diagnostics can tell us whether a specific Chromium build
  // rejects the command instead of losing the completed crawl.
  await installPageForegroundProtection(page).catch(async error => {
    await options.onProgress?.({
      foregroundProtectionError: error?.message || String(error)
    });
  });

  const automaticResult = await crawlAutomaticConversation(page, options);

  if (process.env[MANUAL_INSPECTION_ENV] !== '1') return automaticResult;

  const [{ runManualInspection }, { installManualScrollAssist, restoreManualScrollAssist }] = await Promise.all([
    import('./manual-inspection.mjs'),
    import('./manual-scroll-assist.mjs')
  ]);
  const onDiagnosticProgress = patch => options.onProgress?.({
    ...patch,
    stage: 'diagnostic_validation'
  });

  // The beta13.1 manual remounter could change scrollTop hundreds of times
  // while ChatGPT's virtualized turn window merely oscillated. Wrap setTop only
  // for this diagnostic phase so repeated logical non-progress automatically
  // escalates to the larger displacement that recovered turn 14 manually.
  await installManualScrollAssist(page).catch(() => {});
  try {
    await runManualInspection(page, {
      onProgress: onDiagnosticProgress,
      shouldCancel: options.shouldCancel,
      convergeMounted: async () => {
        // Human interaction can mount another nested generation. Reuse the
        // automatic turn-scoped fixed point and then offer the live turn back
        // to the same retention authority.
        await crawlerTesting.expandMounted(page, 500, options.onProgress, options.shouldCancel);
        await page.evaluate(() => window.__archiveCrawler.capture());
      }
    });
  } catch (error) {
    if (isCancellation(error, options.shouldCancel)) throw error;

    // Manual diagnostics are observational. A diagnostic-only failure must not
    // discard the already completed automatic capture or richer content exposed
    // before the failure.
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
  } finally {
    await restoreManualScrollAssist(page).catch(() => {});
  }

  return automaticResult;
}

export const __testing = { ...crawlerTesting };
