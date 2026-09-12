import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installCrawler } from '../src/crawler-core.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <section data-testid="conversation-turn-1" data-message-author-role="assistant">
        <p>A</p><p>B</p><p>C</p>
      </section>
      <section data-testid="conversation-turn-2" data-message-author-role="assistant">
        <p>base</p>
        <details><summary>Reasoning</summary><p>already present detail payload</p></details>
        <button aria-expanded="false" aria-controls="reasoning">Worked for 1s</button>
        <div id="reasoning"><p>same semantic payload</p></div>
      </section>
      <section data-testid="conversation-turn-3" data-message-author-role="assistant">
        <p>Read <a id="docs">documentation</a></p>
      </section>
    </main>
  `);

  await installCrawler(page);

  // First-seen poorer subset: observed DOM generation changes, retained semantic
  // evidence does not. This must not invalidate disclosure completion proofs.
  const turn1Revision = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-1'));
  await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="conversation-turn-1"]');
    turn.innerHTML = '<p>A</p><p>B</p>';
    window.__archiveCrawler.captureTurn('conversation-turn-1');
  });
  const poorerRevision = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-1'));
  assert.equal(poorerRevision, turn1Revision, 'a first-seen poorer semantic subset must not advance the semantic revision');

  // Capture is observational: closed native details remain closed in the live
  // page while the detached retained clone exposes their already-present content.
  await page.evaluate(() => window.__archiveCrawler.captureTurn('conversation-turn-2'));
  const detailsState = await page.evaluate(() => ({
    liveOpen: document.querySelector('[data-testid="conversation-turn-2"] details').open,
    retainedHtml: window.__archiveCrawler.state.turns['conversation-turn-2'].html
  }));
  assert.equal(detailsState.liveOpen, false, 'captureTurn() must not open live native details');
  assert.match(detailsState.retainedHtml, /<details open/, 'detached archive clone should expose native details content');

  // Presentation-only collapsed/open state is not semantic evidence.
  const turn2Revision = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-2'));
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="conversation-turn-2"] button[aria-expanded]');
    button.setAttribute('aria-expanded', 'true');
    window.__archiveCrawler.captureTurn('conversation-turn-2');
  });
  const presentationRevision = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-2'));
  assert.equal(presentationRevision, turn2Revision, 'aria-expanded presentation alone must not advance semantic revision');

  // Attribute-only semantic hydration must recapture the owning turn through the
  // mount-retention observer; no child/text mutation or explicit capture call.
  const turn3Revision = await page.evaluate(() => window.__archiveCrawler.turnRevision('conversation-turn-3'));
  await page.evaluate(() => document.querySelector('#docs').setAttribute('href', 'https://example.test/docs'));
  await page.waitForTimeout(80);
  const hydrated = await page.evaluate(() => ({
    revision: window.__archiveCrawler.turnRevision('conversation-turn-3'),
    html: window.__archiveCrawler.state.turns['conversation-turn-3'].html
  }));
  assert.ok(hydrated.revision > turn3Revision, 'href-only semantic hydration must advance retained semantic evidence');
  assert.match(hydrated.html, /https:\/\/example\.test\/docs/);

  // A virtualized turn may mount and disappear in the same JavaScript task.
  // MutationRecord.addedNodes still carries the detached node; beta3 must retain
  // that concrete node rather than re-querying the live document by id.
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.setAttribute('data-testid', 'conversation-turn-4');
    section.setAttribute('data-message-author-role', 'assistant');
    section.innerHTML = '<p>ephemeral same-batch turn</p>';
    document.querySelector('main').append(section);
    section.remove();
  });
  await page.waitForTimeout(80);
  const ephemeral = await page.evaluate(() => window.__archiveCrawler.state.turns['conversation-turn-4']);
  assert.ok(ephemeral, 'same-batch mounted/detached turn must be retained from the observed node reference');
  assert.match(ephemeral.html, /ephemeral same-batch turn/);
} finally {
  await browser.close();
}

console.log('beta3 semantic revision + observational capture + retention runtime test passed');
