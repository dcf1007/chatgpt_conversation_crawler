import { installCrawler as installPageCrawler } from './crawler-base.mjs';
import { installMountRetention } from './crawler-mount-retention.mjs';
import { installDisclosureState } from './crawler-disclosure-state.mjs';
import { installCrawlerNavigation } from './crawler-navigation.mjs';
import { ensurePageForegroundProtection } from './runtime-browser.mjs';
import { expandMounted, waitForDisclosureHydration } from './crawler-expansion.mjs';
import {
  CRAWLER_PROGRESS_LIMITS,
  crawlAutomaticConversation,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
} from './crawler-traversal.mjs';

/** Install all permanent page-side state required by the crawler. */
export async function installCrawler(page) {
  // Foreground-equivalent scheduling belongs to the crawler core so it remains
  // active after development diagnostics are removed.
  await ensurePageForegroundProtection(page).catch(() => {});
  await installPageCrawler(page);
  await installMountRetention(page);
  await installDisclosureState(page);
  // Logical virtualizer progress and adaptive displacement are likewise core
  // navigation behavior shared by automatic traversal and later diagnostics.
  await installCrawlerNavigation(page);
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
  verifyOldestMessages,
  installCrawlerNavigation
};
