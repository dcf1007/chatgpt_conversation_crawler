import { installPageCrawler } from './crawler-base.mjs';
import { installMountRetention } from './crawler-mount-retention.mjs';
import { installDisclosureState } from './crawler-disclosure-state.mjs';
import { installCrawlerNavigation } from './crawler-navigation.mjs';
import { installBeta4State } from './crawler-beta4-state.mjs';
import { ensurePageForegroundProtection } from './runtime-browser.mjs';
import { CRAWLER_PROGRESS_LIMITS } from './crawler-traversal.mjs';
import { runBeta4Traversal } from './crawler-beta4-closure.mjs';

/** Install all permanent page-side state required by the crawler. */
export async function installCrawler(page) {
  await ensurePageForegroundProtection(page).catch(() => {});
  await installPageCrawler(page);
  await installDisclosureState(page);
  // The lightweight install smoke uses a Node-side page.evaluate shim; real
  // Chromium already exposes CSS.escape. Keep that compatibility shim explicit
  // rather than making beta4 state depend on a browser-only global at install.
  await page.evaluate(() => {
    if (!globalThis.CSS) globalThis.CSS = { escape: value => String(value) };
  }).catch(() => {});
  await installBeta4State(page);
  await installMountRetention(page);
  await installCrawlerNavigation(page);
}

/** Run the automatic beta4 capture/closure pipeline. */
export async function crawlAutomaticConversation(page, options = {}) {
  await installCrawler(page);
  return runBeta4Traversal(page, options);
}

export { CRAWLER_PROGRESS_LIMITS };
