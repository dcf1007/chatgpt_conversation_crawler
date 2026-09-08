import { installCrawler as installPageCrawler } from './crawler-base.mjs';
import { installMountRetention } from './crawler-mount-retention.mjs';
import { installBeta8Diagnostics } from './crawler-page-diagnostics.mjs';
import { expandMounted, waitForDisclosureHydration } from './crawler-expansion.mjs';
import {
  crawlAutomaticConversation,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
} from './crawler-traversal.mjs';

/**
 * Install page-side retention first, then mount-triggered completeness capture
 * and the turn-scoped disclosure diagnostics.
 */
export async function installCrawler(page) {
  await installPageCrawler(page);
  await installMountRetention(page);
  await installBeta8Diagnostics(page);
}

/** Run the automatic beta9 capture pipeline. */
export async function crawlConversation(page, options = {}) {
  await installCrawler(page);
  const result = await crawlAutomaticConversation(page, options);

  // Drain any tiny mount-settle timers and capture the currently mounted range
  // once more before the automatic result is handed to manual diagnostics or
  // final archive assembly.
  await page.evaluate(() => window.__archiveCrawler.flushMountRetention?.());
  return result;
}

export const __testing = {
  expandMounted,
  waitForDisclosureHydration,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
};
