import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../src/crawler-core.mjs', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../src/crawler.mjs', import.meta.url), 'utf8');
const session = fs.readFileSync(new URL('../src/chatgpt-session.mjs', import.meta.url), 'utf8');
const expansion = fs.readFileSync(new URL('../src/crawler-expansion.mjs', import.meta.url), 'utf8');
const traversal = fs.readFileSync(new URL('../src/crawler-traversal.mjs', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

assert.match(core, /installMountRetention/);
assert.match(core, /installDisclosureState/);
assert.match(core, /installCrawlerNavigation/);
assert.match(core, /ensurePageForegroundProtection/);
assert.match(core, /flushMountRetention/);
assert.doesNotMatch(wrapper, /installManualScrollAssist/, 'development wrapper must not own navigation semantics');
assert.doesNotMatch(wrapper, /installPageForegroundProtection/, 'development wrapper must not own foreground protection');
assert.match(session, /from '\.\/runtime-browser\.mjs'/, 'authenticated persistent contexts must use the protected Chromium runtime explicitly');
assert.doesNotMatch(session, /from 'playwright'/, 'session manager must not bypass the protected Chromium runtime import');
assert.match(server, /installTransientContextRetention/);
assert.match(server, /flushTransientContextRetention/);
assert.match(expansion, /turnDisclosureSample/);
assert.match(expansion, /mountedDisclosureSample/);
assert.match(traversal, /verifyOldestMessages/);
assert.match(traversal, /reconcileRetainedDisclosures/);
assert.match(traversal, /navigationStagnantSteps/);
assert.match(traversal, /ensurePageForegroundProtection/);

console.log('beta14.2 permanent core/runtime module contract smoke test passed');
