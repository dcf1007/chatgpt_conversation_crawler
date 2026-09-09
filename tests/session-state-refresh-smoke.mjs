import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
assert.match(html,/sessionRefreshInFlight=false/);assert.match(html,/if\(sessionRefreshInFlight\)return;sessionRefreshInFlight=true/);assert.match(html,/finally\{sessionRefreshInFlight=false\}/);assert.match(html,/lastSession&&\(lastSession\.busy\|\|lastSession\.loginWindowOpen\|\|lastSession\.verificationWindowOpen\)\)void refreshSession\(\)/);assert.doesNotMatch(html,/setInterval\(\(\)=>\{if\(lastSession\)renderSession\(lastSession\)\},1000\)/);assert.match(html,/if\(s\.verificationWindowOpen\)label='Checking session'/);
console.log('session state refresh smoke test passed');
