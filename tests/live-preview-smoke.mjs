import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const previewHtml = fs.readFileSync(new URL('../public/preview.html', import.meta.url), 'utf8');

const launcherMatch = indexHtml.match(/preview\.html\?([A-Za-z0-9_-]+)=\$\{encodeURIComponent\(currentJobId\)\}/);
assert.ok(launcherMatch, 'main UI must launch preview.html with the current archive job id');
const launchedParameter = launcherMatch[1];

assert.match(previewHtml, /params\.get\('job'\)\|\|params\.get\('id'\)/, 'preview page must accept both the canonical job parameter and the beta10 id parameter');
assert.ok(['job', 'id'].includes(launchedParameter), `unexpected preview job parameter: ${launchedParameter}`);
assert.match(previewHtml, /\/api\/archive\/status\/\$\{encodeURIComponent\(job\)\}\?preview=1/, 'preview page must activate demand-driven preview generation');
assert.match(previewHtml, /\/api\/archive\/preview\/\$\{encodeURIComponent\(job\)\}/, 'preview page must fetch the generated preview snapshot');
assert.match(previewHtml, /missing archive job id/, 'preview page should expose a useful error when opened without an id');

console.log(`live preview parameter compatibility smoke test passed (${launchedParameter})`);
