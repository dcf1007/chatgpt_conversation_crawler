import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

assert.match(html, /sessionRefreshInFlight\s*=\s*false/, 'session status refresh must have an in-flight guard');
assert.match(html, /if\s*\(sessionRefreshInFlight\)\s*return;[\s\S]*?sessionRefreshInFlight\s*=\s*true/, 'refreshSession must reject overlapping status requests');
assert.match(html, /finally\s*\{[\s\S]*?sessionRefreshInFlight\s*=\s*false/, 'refreshSession must always release its in-flight guard');
assert.match(
  html,
  /lastSession\s*&&\s*\(lastSession\.busy\s*\|\|\s*lastSession\.loginWindowOpen\s*\|\|\s*lastSession\.verificationWindowOpen\)\)\s*\{?\s*void refreshSession\(\)/,
  'active session operations must poll fresh backend status'
);
assert.doesNotMatch(
  html,
  /setInterval\(\(\)=>\{if\(lastSession\)renderSession\(lastSession\)\},1000\)/,
  'session timer must not repaint cached state forever'
);
assert.match(html, /if\s*\(session\.verificationWindowOpen\)\s*label\s*=\s*'Checking session'/, 'interactive check should be visible in the session pill');

console.log('session state refresh smoke test passed');
