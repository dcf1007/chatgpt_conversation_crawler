import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
assert.match(workflow, /pull_request:/, 'validation workflow must run for pull requests');
assert.match(workflow, /needs:\s*validate/, 'release job must depend on validation');
assert.match(workflow, /github\.event_name\s*!=\s*'pull_request'/, 'pull requests must validate without publishing');
assert.match(workflow, /npm install/, 'runtime validation must install dependencies');
assert.match(workflow, /for test_file in tests\/\*\.mjs/, 'workflow must execute the whole runtime smoke suite');
assert.match(workflow, /name:\s*dev-diagnostic-package/, 'validated PR artifact must use a stable development name');
assert.match(workflow, /\*\-dev\*/, 'PR packaging must accept dev suffix variants such as dev2.1');
assert.match(workflow, /gh release delete[^\n]+--cleanup-tag/, 'existing releases must be replaced under mutable-release policy');
assert.match(workflow, /gh release create/, 'release must be recreated at the validated SHA');
assert.doesNotMatch(workflow, /leaving it unchanged|no release was modified/i, 'workflow must not preserve stale immutable releases');

console.log('v1.7.1 beta4 release workflow smoke test passed');
