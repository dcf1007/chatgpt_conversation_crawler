import assert from 'node:assert/strict';
import { installTransientContextRetention } from '../src/transient-context-retention.mjs';

let observer = null;
class MockMutationObserver {
  constructor(callback) { this.callback = callback; observer = this; }
  observe() {}
  disconnect() {}
}
globalThis.MutationObserver = MockMutationObserver;
globalThis.window = globalThis;

const calls = { markers: 0, app: 0, image: 0, bindings: 0 };
globalThis.document = {
  documentElement: {},
  querySelector() { return null; }
};
globalThis.__archiveCrawler = {
  captureTimelineMarkers() { calls.markers++; }
};

const page = {
  async exposeBinding(name, callback) {
    calls.bindings++;
    globalThis[name] = async kind => {
      if (kind === 'app') calls.app++;
      if (kind === 'image') calls.image++;
      return callback({}, kind);
    };
  },
  async evaluate(callback, argument) { return callback(argument); }
};

await installTransientContextRetention(page);
assert.ok(observer, 'expected transient-context MutationObserver');

const marker = {
  matches(selector) { return selector.includes('[role="separator"]'); },
  querySelector() { return null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: marker, addedNodes: [marker] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.markers >= 1, 'timeline marker mutation should retain markers');

const app = {
  matches(selector) { return selector.includes('data-app-block-preview'); },
  querySelector(selector) { return selector.includes('data-app-block-preview') ? this : null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: app, addedNodes: [app] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.app >= 1, 'app-block mutation should request frame capture');

const image = {
  matches(selector) { return selector.includes('img'); },
  querySelector(selector) { return selector.includes('img') ? this : null; },
  closest() { return null; }
};
observer.callback([{ type: 'childList', target: image, addedNodes: [image] }]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.ok(calls.image >= 1, 'image mutation should request main-image retention');


console.log('v1.7 beta2 transient-context retention smoke test passed');
