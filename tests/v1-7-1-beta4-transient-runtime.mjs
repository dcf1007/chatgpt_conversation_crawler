import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installTransientContextRetention, flushTransientContextRetention, sealTransientContextRetention } from '../src/transient-context-retention.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main><section data-testid="conversation-turn-1"><p>hello</p></section></main>');
  await page.evaluate(() => {
    window.__archiveCrawler = {
      captureTimelineMarkers() {},
      state: {}
    };
  });
  await installTransientContextRetention(page);
  const before = await flushTransientContextRetention(page);
  assert.equal(before.installed, true);
  assert.equal(before.sealed, false);

  const sealed = await sealTransientContextRetention(page);
  assert.equal(sealed.installed, true);
  assert.equal(sealed.sealed, true);
  const observerGone = await page.evaluate(() => window.__archiveTransientContextObserver === null);
  assert.equal(observerGone, true, 'seal must disconnect the page-side mutation observer');

  const after = await flushTransientContextRetention(page);
  assert.equal(after.sealed, true, 'post-seal server flush must be a no-op');
  assert.equal(after.captures, sealed.captures, 'post-seal flush must not add passive captures');

  console.log('v1.7.1 beta4 transient retention runtime test passed');
} finally {
  await browser.close();
}
