import { installPageCrawler } from './crawler-base.mjs';
import { installMountRetention } from './crawler-mount-retention.mjs';
import { installDisclosureState } from './crawler-disclosure-state.mjs';
import { installCrawlerNavigation } from './crawler-navigation.mjs';
import { ensurePageForegroundProtection } from './runtime-browser.mjs';
import {
  CRAWLER_PROGRESS_LIMITS,
  runAutomaticTraversal
} from './crawler-traversal.mjs';

/** Install all permanent page-side state required by the crawler. */
export async function installCrawler(page) {
  // Foreground-equivalent scheduling belongs to the crawler core so it remains
  // active after development diagnostics are removed.
  await ensurePageForegroundProtection(page).catch(() => {});
  await installPageCrawler(page);
  await installDisclosureState(page);
  await installMountRetention(page);
  // Logical virtualizer progress and adaptive displacement are likewise core
  // navigation behavior shared by automatic traversal and later diagnostics.
  await installCrawlerNavigation(page);
}

/** Run the automatic capture pipeline. */
export async function crawlAutomaticConversation(page, options = {}) {
  await installCrawler(page);
  // Beta3 traversal drains and seals mount retention before its final semantic
  // closure proof. Do not perform another asynchronous retention flush after
  // runAutomaticTraversal() returns, because that could mutate the retained
  // corpus behind an already-issued convergence result.
  return runAutomaticTraversal(page, options);
}

export { CRAWLER_PROGRESS_LIMITS };
