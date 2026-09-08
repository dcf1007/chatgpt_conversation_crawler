import assert from 'node:assert/strict';
import { finalizeConversationFidelity } from '../src/archive-fidelity.mjs';

const equal = finalizeConversationFidelity({
  html: '<html><head></head><body><div><strong>Expansion clicks</strong>511</div><div><strong>Confirmed expansions</strong>511</div></body></html>'
}).html;
assert.match(equal, /<strong>Disclosures expanded<\/strong>511/);
assert.doesNotMatch(equal, /Expansion clicks|Confirmed expansions/);

const retry = finalizeConversationFidelity({
  html: '<html><head></head><body><div><strong>Expansion clicks</strong>514</div><div><strong>Confirmed expansions</strong>511</div></body></html>'
}).html;
assert.match(retry, /511 confirmed from 514 click attempts/);

console.log('archive disclosure metadata consolidation smoke test passed');
