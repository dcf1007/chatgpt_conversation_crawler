import { installCrawler as installPageCrawler } from './crawler-base.mjs';
import { installMountRetention } from './crawler-mount-retention.mjs';
import { installDisclosureState } from './crawler-disclosure-state.mjs';
import { expandMounted, waitForDisclosureHydration } from './crawler-expansion.mjs';
import {
  CRAWLER_PROGRESS_LIMITS,
  crawlAutomaticConversation,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
} from './crawler-traversal.mjs';

/** Install all page-side state required by the automatic crawler. */
export async function installCrawler(page) {
  await installPageCrawler(page);
  await installMountRetention(page);
  await installDisclosureState(page);
}

/** Run the automatic capture pipeline. */
export async function crawlConversation(page, options = {}) {
  await installCrawler(page);
  const result = await crawlAutomaticConversation(page, options);
  await page.evaluate(() => window.__archiveCrawler.flushMountRetention?.());
  return result;
}

export { CRAWLER_PROGRESS_LIMITS };

export const __testing = {
  expandMounted,
  waitForDisclosureHydration,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
};
