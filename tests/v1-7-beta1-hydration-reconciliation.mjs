import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCrawler } from '../src/crawler-core.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <section data-testid="conversation-turn-1" data-message-author-role="assistant">
        <p>A</p><p>B</p>
      </section>
      <section data-testid="conversation-turn-2" data-message-author-role="assistant">
        <p>X</p><p>X</p>
      </section>
      <section data-testid="conversation-turn-3" data-message-author-role="assistant">
        <button aria-expanded="false" aria-controls="reasoning">Thought for 1s</button>
        <div id="reasoning"><p>base</p></div>
      </section>
      <section data-testid="conversation-turn-4" data-message-author-role="assistant">
        <p>shared</p><div>alpha</div>
      </section>
      <section data-testid="conversation-turn-5" data-message-author-role="assistant">
        <p>text that will disappear</p>
      </section>
    </main>
  `);
  await installCrawler(page);

  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-1"]');
    turn.innerHTML = '<p>A</p><p>C</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-1');
  });
  let stats = await page.evaluate(() => window.__archiveCrawler.stats());
  let retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-1']);
  assert.equal(stats.hydrationConflictsUnresolved, 1);
  assert.equal(retained.contentUnits.length, 3, 'incomparable generations must retain the multiset union');
  assert.match(retained.html, />B</);
  assert.match(retained.html, />C</);

  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-1"]');
    turn.innerHTML = '<p>A</p><p>B</p><p>C</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-1');
  });
  stats = await page.evaluate(() => window.__archiveCrawler.stats());
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-1']);
  assert.equal(stats.hydrationConflictsUnresolved, 0);
  assert.equal(stats.hydrationConflictsResolved, 1);
  assert.equal(retained.hydrationConflictActive, false);

  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-2"]');
    turn.innerHTML = '<p>X</p><p>Y</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-2');
  });
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-2']);
  assert.equal(retained.contentUnits.length, 3, 'duplicate occurrences inside a generation must not be collapsed');


  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-4"]');
    turn.innerHTML = '<p>shared</p><div>bravo</div>';
    window.__archiveCrawler.captureTurn('conversation-turn-4');
  });
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-4']);
  assert.match(retained.html, />alpha</, 'generic non-semantic content from the earlier generation must be retained');
  assert.match(retained.html, />bravo</, 'generic non-semantic content from the later generation must be retained');

  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-5"]');
    turn.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="retained media">';
    window.__archiveCrawler.captureTurn('conversation-turn-5');
  });
  retained = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-5']);
  assert.match(retained.html, /text that will disappear/, 'incomparable text content must survive a media-rich remount');
  assert.match(retained.html, /retained media/, 'new media content must be retained alongside earlier text');

  const revisionBefore = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-3'));
  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-3"]');
    turn.innerHTML = '<button aria-expanded="true" aria-controls="reasoning">Thought for 1s</button><div id="reasoning"><p>base</p><p>expanded</p></div>';
    window.__archiveCrawler.captureTurn('conversation-turn-3');
  });
  const revisionExpanded = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-3'));
  assert.ok(revisionExpanded > revisionBefore);
  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-3"]');
    turn.innerHTML = '<button aria-expanded="false" aria-controls="reasoning">Thought for 1s</button><div id="reasoning"><p>base</p></div>';
    window.__archiveCrawler.captureTurn('conversation-turn-3');
  });
  const revisionRemounted = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-3'));
  assert.equal(revisionRemounted, revisionExpanded, 'a known poorer collapsed generation must not advance semantic revision');
} finally {
  await browser.close();
}

console.log('v1.7 beta1 hydration reconciliation runtime test passed');
