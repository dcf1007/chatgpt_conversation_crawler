import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../src/crawler-core.mjs', import.meta.url), 'utf8');
const expansion = fs.readFileSync(new URL('../src/crawler-expansion.mjs', import.meta.url), 'utf8');
const disclosure = fs.readFileSync(new URL('../src/crawler-disclosure-state.mjs', import.meta.url), 'utf8');
const transient = fs.readFileSync(new URL('../src/transient-context-retention.mjs', import.meta.url), 'utf8');

for (const label of ['Current action', 'Coverage', 'Position in loaded content', 'Worker heartbeat:', 'Last substantive progress:']) {
  assert.ok(html.includes(label), `missing visible UI label: ${label}`);
}
assert.match(server, /stage: job\.stage/);
assert.match(server, /progressLimits: CRAWLER_PROGRESS_LIMITS/);
assert.match(html, /job\.stage==='traversal'/);
assert.match(html, /job\.stage==='oldest_verification'/);
assert.match(html, /job\.stage==='reconciliation'/);
assert.doesNotMatch(html, /function stageFor|diagnostic validation|waiting for you/i, 'clean UI must not contain development diagnostic state');
assert.doesNotMatch(server, /diagnosticStep|diagnosticSteps|waitingForUser/, 'clean server contract must not carry development-only state');
assert.match(core, /installDisclosureState/);
assert.match(expansion, /crawler-disclosure-state\.mjs/);
assert.doesNotMatch(core + expansion, /Beta8Diagnostics|crawler-page-diagnostics/, 'automatic crawler must use version-neutral disclosure authority');
assert.match(disclosure, /installDisclosureState/);
assert.equal(fs.existsSync(new URL('../src/crawler-page-diagnostics.mjs', import.meta.url)), false, 'misleading crawler-page-diagnostics module must be removed');
assert.match(transient, /captureTimelineMarkers/);
assert.match(transient, /captureMountedAppBlocks/);
assert.match(transient, /captureMountedMainImages/);

console.log('beta11 stage/state and clean-boundary contract smoke test passed');
