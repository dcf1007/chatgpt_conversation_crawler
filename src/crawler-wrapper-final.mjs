import {
  installCrawler,
  crawlConversation as crawlBeta7Conversation,
  __testing as beta7Testing
} from './crawler-beta7-core.mjs';

const MANUAL_INSPECTION_ENV = 'CHATGPT_CRAWLER_MANUAL_INSPECTION';

export { installCrawler };

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
}

// Preserve the existing beta7 test surface. Manual-inspection pure helpers are
// tested separately so this module can still be imported without Playwright's
// runtime dependencies being installed in the release syntax job.
export const __testing = { ...beta7Testing };
