import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
assert.match(workflow, /pull_request:/, 'validation workflow must run for pull requests');
assert.match(workflow, /needs:\s*validate/, 'release job must depend on validation');
assert.match(workflow, /github\.event_name\s*!=\s*'pull_request'/, 'pull requests must validate without publishing');
assert.match(workflow, /npm install/, 'runtime validation must install dependencies');
assert.match(workflow, /for test_file in tests\/\*\.mjs/, 'workflow must execute the whole runtime smoke suite');
assert.match(workflow, /name:\s*beta13-dev-diagnostic-package/, 'validated PR artifact must use the beta13-dev name');

console.log('beta13-dev release workflow smoke test passed');
