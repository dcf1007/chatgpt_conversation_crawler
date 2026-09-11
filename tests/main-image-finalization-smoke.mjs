import assert from 'node:assert/strict';
import { finalizeMainImages } from '../src/main-images.mjs';

const token = '__ARCHIVE_MAIN_IMAGE_TEST__';
const prepared = {
  totalBytes: 3,
  records: [{
    token,
    url: 'https://example.invalid/image.png',
    error: '',
    image: {
      dataUrl: 'data:image/png;base64,AAEC',
      size: 3,
      source: 'browser-response',
      mimeCorrected: false
    }
  }]
};

const referenced = finalizeMainImages({
  html: `<html><body><div><strong>Images</strong>pending</div><img src="${token}"></body></html>`,
  stats: {}
}, prepared);

assert.equal(referenced.stats.imagesTotal, 1);
assert.equal(referenced.stats.imagesEmbedded, 1);
assert.equal(referenced.stats.imagesUnreferencedAfterSanitization, 0);
assert.equal(referenced.stats.embeddedImageSourceBytes, 3);
assert.equal(referenced.stats.retainedImageSourceBytes, 3);
assert.match(referenced.html, /data:image\/png;base64,AAEC/);
assert.doesNotMatch(referenced.html, new RegExp(token));

const omitted = finalizeMainImages({
  html: '<html><body><div><strong>Images</strong>pending</div></body></html>',
  stats: {}
}, prepared);

assert.equal(omitted.stats.imagesTotal, 0);
assert.equal(omitted.stats.imagesEmbedded, 0);
assert.equal(omitted.stats.imagesUnreferencedAfterSanitization, 1);
assert.equal(omitted.stats.embeddedImageSourceBytes, 0);
assert.equal(omitted.stats.retainedImageSourceBytes, 3);
assert.match(omitted.html, /1 retained source image not referenced by sanitized content/);

console.log('main-image finalization smoke test passed');
