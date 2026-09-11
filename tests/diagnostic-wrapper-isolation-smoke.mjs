import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverDev = fs.readFileSync(new URL('../server-dev.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const crawlerFacade = fs.readFileSync(new URL('../src/crawler.mjs', import.meta.url), 'utf8');
const crawlerCore = fs.readFileSync(new URL('../src/crawler-core.mjs', import.meta.url), 'utf8');
const recorder = fs.readFileSync(new URL('../src/mhtml-recorder.mjs', import.meta.url), 'utf8');

assert.match(serverDev, /runtime-browser\.mjs/);
assert.match(serverDev, /CHATGPT_CRAWLER_MANUAL_INSPECTION/);
assert.match(serverDev, /mhtml-dev-hook\.mjs/);
assert.match(serverDev, /server\.mjs/);
assert.doesNotMatch(server, /mhtml-dev-hook|manual-inspection|CHATGPT_CRAWLER_MANUAL_INSPECTION/, 'normal server must stay diagnostic-free');

assert.match(crawlerFacade, /crawlAutomaticConversation/);
assert.match(crawlerFacade, /CRAWLER_PROGRESS_LIMITS/);
assert.match(crawlerFacade, /manual-inspection\.mjs/);
assert.match(crawlerFacade, /stage: 'diagnostic_validation'/);
assert.match(crawlerCore, /crawlAutomaticConversation/);
assert.doesNotMatch(crawlerCore, /manual-inspection|mhtml/i, 'automatic crawler core must remain unchanged by diagnostics');

assert.match(recorder, /diagnosticId: diagnosticState\.id/);
assert.doesNotMatch(recorder, /\bjobId\b/);

console.log('development wrapper isolation smoke test passed');
