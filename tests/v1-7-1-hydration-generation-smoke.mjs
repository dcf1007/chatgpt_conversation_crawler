import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCrawler } from '../src/crawler-core.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <section data-testid="conversation-turn-1" data-message-author-role="assistant">
        <p>Read the documentation</p>
      </section>
      <section data-testid="conversation-turn-2" data-message-author-role="assistant">
        <p>A</p><p>B</p>
      </section>
    </main>
  `);
  await installCrawler(page);

  // Progressive enrichment: the prose is unchanged and only gains a link.
  // This must dominate the earlier observation instead of becoming a permanent
  // competing hydration generation.
  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-1"]');
    turn.innerHTML = '<p>Read the <a href="https://example.test/docs">documentation</a></p>';
    window.__archiveCrawler.captureTurn('conversation-turn-1');
  });
  let stats = await page.evaluate(() => window.__archiveCrawler.stats());
  let retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-1']);
  assert.equal(stats.hydrationConflictsUnresolved, 0, 'link enrichment must not create an unresolved hydration conflict');
  assert.match(retained.html, /https:\/\/example\.test\/docs/);

  // Genuine incomparable payloads still preserve their multiset union, but the
  // canonical observed generation remains a real DOM generation rather than the
  // synthetic preservation union.
  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-2"]');
    turn.innerHTML = '<p>A</p><p>C</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-2');
  });
  stats = await page.evaluate(() => window.__archiveCrawler.stats());
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-2']);
  assert.equal(stats.hydrationConflictsUnresolved, 1);
  assert.equal(retained.contentUnits.length, 3, 'preservation state must retain A+B+C');
  assert.equal(retained.canonicalObserved.contentUnits.length, 2,
    'canonical observed generation must remain one real two-unit DOM generation');
  assert.equal(retained.evidenceFacts.length, 3, 'semantic evidence union must retain all distinct observed facts');

  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-2"]');
    turn.innerHTML = '<p>A</p><p>B</p><p>C</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-2');
  });
  stats = await page.evaluate(() => window.__archiveCrawler.stats());
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-2']);
  assert.equal(stats.hydrationConflictsUnresolved, 0);
  assert.equal(stats.hydrationConflictsResolved, 1,
    'a later real generation covering all accumulated semantic evidence must resolve the conflict');
  assert.equal(retained.hydrationConflictActive, false);
  assert.equal(retained.canonicalObserved.contentUnits.length, 3);
} finally {
  await browser.close();
}

console.log('v1.7.1 canonical hydration generation runtime test passed');
