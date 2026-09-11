import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/snapshot.mjs', import.meta.url), 'utf8');

assert.match(source, /for \(const a of section\.querySelectorAll\('a\[href\]'\)\)/, 'source anchors must survive sanitization');
assert.match(source, /a\.target='_blank'; a\.rel='noopener noreferrer'/, 'preserved anchors must be safe in the static archive');
assert.match(source, /else if \(text && !uiOnly\)/, 'text-bearing content controls must retain their visible label');
assert.match(source, /archive-inline-label/, 'non-functional content controls must flatten to static visible text');
assert.match(source, /preservedMedia = button\.querySelector\('img,video,audio,picture,object,embed'\)/, 'media-bearing controls must retain their media descendants');
assert.doesNotMatch(source, /behavior-btn[^\n]*href/i, 'the crawler must not fabricate an href for behavior buttons whose target is not exposed by the DOM');

console.log('link/content-control fidelity smoke test passed');
