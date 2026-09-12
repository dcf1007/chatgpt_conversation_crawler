import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installPageCrawler } from '../src/crawler-base.mjs';
import { installDisclosureState } from '../src/crawler-disclosure-state.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`
    <section data-testid="conversation-turn-2">
      <button id="first" aria-expanded="false" aria-controls="volatile-a">Worked for 5s</button>
      <button id="second" aria-expanded="false" aria-controls="volatile-b">Worked for 5s</button>
    </section>
  `);
  await installPageCrawler(page);
  await installDisclosureState(page);
  const before = await page.evaluate(() => [
    window.__archiveCrawler.logicalDisclosureKey(document.querySelector('#first')),
    window.__archiveCrawler.logicalDisclosureKey(document.querySelector('#second'))
  ]);
  await page.evaluate(() => {
    document.querySelector('#first').setAttribute('aria-controls', 'remounted-x');
    document.querySelector('#second').setAttribute('aria-controls', 'remounted-y');
  });
  const after = await page.evaluate(() => [
    window.__archiveCrawler.logicalDisclosureKey(document.querySelector('#first')),
    window.__archiveCrawler.logicalDisclosureKey(document.querySelector('#second'))
  ]);
  assert.deepEqual(after, before, 'persistent logical disclosure identity must ignore volatile aria-controls ids');
  assert.notEqual(before[0], before[1], 'same-label sibling disclosures must retain occurrence identity');
  console.log('v1.7.1 beta4 disclosure identity runtime test passed');
} finally {
  await browser.close();
}
