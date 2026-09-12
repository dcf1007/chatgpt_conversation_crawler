import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCrawler } from '../src/crawler-core.mjs';
import { scan } from '../src/crawler-traversal.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const fingerprints = [];
  for (const height of [1000, 4000]) {
    const page = await browser.newPage({ viewport: { width: 1000, height } });
    await page.setContent(`
      <style>
        body { margin: 0; }
        main { display: block; }
        #head { height: 300px; }
        #giant { height: 12000px; }
        #tail-user { min-height: 20px; }
        #tail-assistant { min-height: 32px; }
        #geometry-noise { height: 140px; }
      </style>
      <main>
        <div id="head"></div>
        <section id="giant" data-testid="conversation-turn-58" data-message-author-role="assistant"><p>giant preceding answer</p></section>
        <section id="tail-user" data-testid="conversation-turn-59" data-message-author-role="user"><p>Great</p></section>
        <section id="tail-assistant" data-testid="conversation-turn-60" data-message-author-role="assistant"><p>tiny final reply</p></section>
        <div id="geometry-noise"></div>
      </main>
    `);
    await installCrawler(page);

    await page.evaluate(() => {
      const crawler = window.__archiveCrawler;
      const originalCapture = crawler.capture.bind(crawler);
      const originalNavigateTop = crawler.navigateTop.bind(crawler);
      let toggle = false;
      window.__endpointNavigateTopCalls = 0;
      crawler.capture = () => {
        const result = originalCapture();
        const metrics = crawler.metrics();
        const maximumTop = Math.max(0, metrics.height - metrics.client);
        if (metrics.top >= maximumTop - 8) {
          document.querySelector('#geometry-noise').style.height = toggle ? '140px' : '190px';
          toggle = !toggle;
        }
        return result;
      };
      crawler.navigateTop = top => {
        const metrics = crawler.metrics();
        const maximumTop = Math.max(0, metrics.height - metrics.client);
        if (Number(top) <= 1 || Number(top) >= maximumTop - 1) window.__endpointNavigateTopCalls++;
        return originalNavigateTop(top);
      };
    });

    const result = await scan(page, 'down', 1, null, null, 120);
    const state = await page.evaluate(() => ({
      endpointNavigateTopCalls: window.__endpointNavigateTopCalls,
      fingerprint: window.__archiveCrawler.retainedCorpusFingerprint(),
      stats: window.__archiveCrawler.stats()
    }));
    assert.equal(result.converged, true, `short-tail semantic endpoint should converge at viewport ${height}`);
    assert.equal(state.endpointNavigateTopCalls, 0, 'exact endpoints must never be routed through adaptive navigateTop()');
    assert.equal(state.stats.turns, 3);
    fingerprints.push(state.fingerprint);
    await page.close();
  }

  assert.equal(fingerprints[0], fingerprints[1], 'semantic retained corpus must be viewport-height invariant for the short-tail case');
} finally {
  await browser.close();
}

console.log('beta3 short-tail endpoint semantic convergence runtime test passed');
