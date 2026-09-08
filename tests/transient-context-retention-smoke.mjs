import assert from 'node:assert/strict';
import { installTransientContextRetention } from '../src/transient-context-retention.mjs';

let observer = null;
class MockMutationObserver {
  constructor(callback) { this.callback = callback; observer = this; }
  observe() {}
  disconnect() {}
}

globalThis.MutationObserver = MockMutationObserver;

const calls = { markers: 0, app: 0, images: 0 };
const page = {
  async evaluate(callback) { return callback(); },
  on() {},
};

globalThis.window = globalThis;
globalThis.document = {
  documentElement: {},
  querySelector() { return null; }
};
globalThis.__archiveCrawler = {
  captureTimelineMarkers() { calls.markers++; }
};

await installTransientContextRetention(page, {
  captureAppBlocks: async () => { calls.app++; },
  captureMainImages: async () => { calls.images++; }
});
assert.ok(observer, 'expected transient-context MutationObserver');

const marker = {
  nodeType: 1,
  matches(selector) { return selector.includes('[role="separator"]'); },
  querySelector() { return null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: marker, addedNodes: [marker] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.markers >= 1, 'timeline marker mutation should retain markers');

const app = {
  nodeType: 1,
  matches(selector) { return selector.includes('data-app-block-preview'); },
  querySelector(selector) { return selector.includes('data-app-block-preview') ? this : null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: app, addedNodes: [app] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.app >= 1, 'app-block mutation should trigger frame capture');

const image = {
  nodeType: 1,
  matches(selector) { return selector === 'img' || selector.includes('img'); },
  querySelector(selector) { return selector.includes('img') ? this : null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: image, addedNodes: [image] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.images >= 1, 'image mutation should trigger main-image retention');

console.log('beta11 transient-context retention smoke test passed');
