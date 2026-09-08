import { installCrawler as installPageCrawler } from './crawler-base.mjs';
import { installBeta8Diagnostics } from './crawler-page-diagnostics.mjs';
import { expandMounted, waitForDisclosureHydration } from './crawler-expansion.mjs';
import {
  crawlAutomaticConversation,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
} from './crawler-traversal.mjs';

/** Install the page-side retention primitives and beta8 disclosure diagnostics. */
export async function installCrawler(page) {
  await installPageCrawler(page);
  await installBeta8Diagnostics(page);
}

/** Run the automatic beta8 capture pipeline. */
export async function crawlConversation(page, options = {}) {
  await installCrawler(page);
  return crawlAutomaticConversation(page, options);
}

export const __testing = {
  expandMounted,
  waitForDisclosureHydration,
  reconcileRetainedDisclosures,
  scan,
  verifyOldestMessages
};
