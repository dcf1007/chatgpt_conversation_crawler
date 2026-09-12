import {
  installCrawler,
  crawlAutomaticConversation,
  CRAWLER_PROGRESS_LIMITS
} from './crawler-core.mjs';
import { processTurnToFixedPoint, retainedTurnIds } from './crawler-turn-processing.mjs';

const MANUAL_INSPECTION_ENV = 'CHATGPT_CRAWLER_MANUAL_INSPECTION';
const DIAGNOSTIC_PROGRESS_EVENT = 'archive-crawler-diagnostic-progress';

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
 * Run the permanent automatic crawler first. Foreground protection, disclosure
 * fixed-point verification, and virtualizer navigation assistance are all core
 * behavior. This development wrapper adds only the independent two-step human
 * comparison after automatic capture completes.
 */
export async function crawlConversation(page, options = {}) {
  // Publish a lightweight page-side progress record for diagnostics. The dev
  // MHTML hook listens to the event rather than polling the page once a second.
  const forwardProgress = async patch => {
    const progress = patch || {};
    await page.evaluate(({ value, eventName }) => {
      window.__archiveDiagnosticProgress = value;
      window.dispatchEvent(new Event(eventName));
    }, {
      eventName: DIAGNOSTIC_PROGRESS_EVENT,
      value: {
        stage: String(progress.stage || ''),
        phase: String(progress.phase || ''),
        pass: Number(progress.pass || 0),
        direction: String(progress.direction || ''),
        step: Number(progress.step || 0),
        scanningStatus: String(progress.scanningStatus || ''),
        scanComplete: Boolean(progress.scanComplete)
      }
    }).catch(() => {});
    return options.onProgress?.(progress);
  };

  const automaticResult = await crawlAutomaticConversation(page, {
    ...options,
    onProgress: forwardProgress
  });

  if (process.env[MANUAL_INSPECTION_ENV] !== '1') return automaticResult;

  const { runManualInspection } = await import('./manual-inspection.mjs');
  const onDiagnosticProgress = patch => forwardProgress({
    ...patch,
    stage: 'diagnostic_validation'
  });

  try {
    await runManualInspection(page, {
      onProgress: onDiagnosticProgress,
      shouldCancel: options.shouldCancel,
      convergeMounted: async targetTurnId => {
        if (!targetTurnId) throw new Error('Manual reconvergence requires the diagnostic target turn id.');
        const ids = await retainedTurnIds(page);
        const result = await processTurnToFixedPoint(page, targetTurnId, ids, {
          onProgress: forwardProgress,
          shouldCancel: options.shouldCancel
        });
        await page.evaluate(id => window.__archiveCrawler.captureTurn(id), targetTurnId);
        return result;
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
  }

  return automaticResult;
}
