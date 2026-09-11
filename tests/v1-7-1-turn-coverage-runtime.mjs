import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCrawler } from '../src/crawler-core.mjs';
import { stabilizeTurnCoverage } from '../src/crawler-turn-processing.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
  await page.setContent(`
    <style>
      body { margin: 0; }
      main { min-height: 4000px; }
      [data-testid="conversation-turn-1"] { position: relative; height: 2600px; }
      #top-content { position: absolute; top: 20px; }
      #lazy-sentinel { position: absolute; top: 1250px; height: 40px; width: 100%; }
      #bottom-content { position: absolute; top: 2500px; }
    </style>
    <main>
      <section data-testid="conversation-turn-1" data-message-author-role="assistant">
        <p id="top-content">top payload</p>
        <div id="lazy-sentinel">middle sentinel</div>
        <p id="bottom-content">bottom payload</p>
      </section>
    </main>
    <script>
      window.lazyMounted = false;
      const sentinel = document.querySelector('#lazy-sentinel');
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting) || window.lazyMounted) return;
        window.lazyMounted = true;
        const payload = document.createElement('p');
        payload.id = 'lazy-payload';
        payload.textContent = 'interior lazy payload';
        sentinel.after(payload);
        observer.disconnect();
      });
      observer.observe(sentinel);
    </script>
  `);

  await installCrawler(page);
  const revisionBefore = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-1'));
  const result = await stabilizeTurnCoverage(page, 'conversation-turn-1');
  const retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-1']);
  const revisionAfter = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-1'));

  assert.equal(result.converged, true, `turn coverage should converge, got ${result.reason}`);
  assert.ok(result.rounds >= 2,
    'interior lazy hydration must force another whole-turn coverage round before convergence');
  assert.ok(result.positionsVisited > 4,
    'a turn taller than the viewport must receive interior coverage positions, not only start/end');
  assert.equal(await page.evaluate(() => window.lazyMounted), true,
    'the interior sentinel must enter the viewport during turn coverage');
  assert.ok(revisionAfter > revisionBefore,
    'lazy interior content must advance the retained semantic turn revision');
  assert.match(retained.html, /interior lazy payload/,
    'content hydrated only in the middle of a tall turn must be retained');
} finally {
  await browser.close();
}

console.log('v1.7.1 whole-turn viewport coverage runtime test passed');
