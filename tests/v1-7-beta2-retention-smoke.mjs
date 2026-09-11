import assert from 'node:assert/strict';
import { __testing as imageTesting } from '../src/main-images.mjs';
import { __testing as appTesting } from '../src/app-blocks.mjs';

const budget = { totalBytes: 0, digests: new Set() };
const first = { digest: 'same', size: 1024, dataUrl: 'data:image/png;base64,AA==' };
const duplicate = { digest: 'same', size: 1024, dataUrl: 'data:image/png;base64,AA==' };
const second = { digest: 'other', size: 2048, dataUrl: 'data:image/png;base64,BB==' };
assert.equal(imageTesting.reserveUniqueImageBytes(budget, first, 4096), true);
assert.equal(imageTesting.reserveUniqueImageBytes(budget, duplicate, 4096), true);
assert.equal(budget.totalBytes, 1024, 'duplicate bytes must consume the image budget once');
assert.equal(imageTesting.reserveUniqueImageBytes(budget, second, 4096), true);
assert.equal(budget.totalBytes, 3072);
assert.equal(imageTesting.reserveUniqueImageBytes(budget, { digest: 'too-big', size: 2048 }, 4096), false);
assert.equal(budget.totalBytes, 3072, 'failed reservation must not mutate the budget');

const previous = { score: 100, contentFingerprint: 'old' };
assert.equal(appTesting.shouldReplaceAppBlock(previous, { score: 99, contentFingerprint: 'new' }), false);
assert.equal(appTesting.shouldReplaceAppBlock(previous, { score: 100, contentFingerprint: 'old' }), false);
assert.equal(appTesting.shouldReplaceAppBlock(previous, { score: 100, contentFingerprint: 'new' }), true, 'equal-richness changed content must replace the old app generation');
assert.equal(appTesting.shouldReplaceAppBlock(previous, { score: 101, contentFingerprint: 'old' }), true);

console.log('v1.7 beta2 retention helper smoke test passed');
