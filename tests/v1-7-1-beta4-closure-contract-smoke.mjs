import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/crawler-beta4-closure.mjs', import.meta.url), 'utf8');
assert.match(source, /FINAL_RECOVERY_MAX_EPOCHS\s*=\s*2/, 'failed-turn recovery must be bounded');
assert.match(source, /currentFailedTurnIds/, 'current failed turns must be final recovery targets');
assert.match(source, /resetTurnPhysicalDisclosureAttempts/, 'new recovery epochs may reset only physical disclosure attempts');
assert.match(source, /sealTransientContextRetention/, 'passive transient retention must seal before final certification');
assert.match(source, /Post-repair closure verification/, 'semantic repair must receive an opposite-direction closure challenge');
assert.match(source, /if \(!remaining\.length && !semanticProgress\) break/, 'clean non-progressing state should stop');
assert.match(source, /if \(remaining\.length && !semanticProgress\) break/, 'same-state failure must not retry forever');
assert.doesNotMatch(source, /bringToFront|historical.*scrollTop/i, 'beta4 recovery must not reintroduce forbidden navigation authority');

console.log('v1.7.1 beta4 closure contract smoke test passed');
