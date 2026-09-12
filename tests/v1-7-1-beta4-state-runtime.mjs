import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installPageCrawler } from '../src/crawler-base.mjs';
import { installDisclosureState } from '../src/crawler-disclosure-state.mjs';
import { installBeta4State } from '../src/crawler-beta4-state.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.setContent(`
    <main>
      <section data-testid="conversation-turn-1" data-message-author-role="assistant">
        <p id="a">alpha</p><p id="b">beta</p>
        <canvas id="chart" width="24" height="12"></canvas>
        <button aria-expanded="false">Worked for 1s</button>
      </section>
    </main>
  `);
  await page.evaluate(() => {
    const ctx = document.querySelector('#chart').getContext('2d');
    ctx.fillRect(0, 0, 10, 10);
  });

  await installPageCrawler(page);
  await installDisclosureState(page);
  await installBeta4State(page);
  await page.evaluate(() => window.__archiveCrawler.capture());

  let state = await page.evaluate(() => ({
    html: window.__archiveCrawler.state.turns['conversation-turn-1'].html,
    stats: window.__archiveCrawler.stats()
  }));
  assert.match(state.html, /<img[^>]+data:image\/png;base64/i, 'main-turn canvas should be preserved as a static image in retained HTML');
  assert.doesNotMatch(state.html, /<canvas\b/i, 'serialized retained HTML should not leave the captured canvas behind');
  assert.equal(state.stats.mainChatCanvasesCaptured, 1);

  await page.evaluate(() => {
    window.__archiveCrawler.markTurnProcessingResult({ turnId: 'conversation-turn-1', converged: false, reason: 'synthetic-first-epoch' });
    window.__archiveCrawler.markTurnProcessingResult({ turnId: 'conversation-turn-1', converged: true, reason: 'turn-fixed-point', revision: window.__archiveCrawler.turnRevision('conversation-turn-1'), actionable: 0, recoveryEpoch: 1 });
  });
  state = await page.evaluate(() => ({
    stats: window.__archiveCrawler.stats(),
    certificate: window.__archiveCrawler.beta4FixedPointCertificates()['conversation-turn-1']
  }));
  assert.equal(state.stats.turnProcessingFailures, 0, 'a later successful recovery must clear current failure state');
  assert.equal(state.stats.turnProcessingFailureEvents, 1, 'historical failure telemetry must remain');
  assert.equal(state.stats.turnProcessingRecoveredTurns, 1, 'recovered turn should be counted');
  assert.equal(state.certificate.processingConverged, true);

  await page.evaluate(() => {
    document.querySelector('#b').textContent = 'gamma';
    window.__archiveCrawler.capture();
  });
  const conflict = await page.evaluate(() => ({
    stats: window.__archiveCrawler.stats(),
    diagnostic: window.__archiveCrawler.beta4ConflictDiagnostics()['conversation-turn-1']
  }));
  assert.equal(conflict.stats.hydrationConflictsUnresolved, 1);
  assert.equal(conflict.stats.hydrationConflictDiagnosticTurns, 1);
  assert.ok(conflict.diagnostic, 'active conflict should have bounded fact diagnostics');
  assert.ok(conflict.diagnostic.currentOnlyByKind['text-p'] >= 1, 'fact diagnostics should identify the differing semantic kind');
  assert.ok(conflict.diagnostic.currentOnlySamples.length <= 16);

  console.log('v1.7.1 beta4 state runtime test passed');
} finally {
  await browser.close();
}
