# v1.6.7-beta6-dev MHTML diagnostics

`v1.6.7-beta6-dev` is a temporary diagnostic build layered on the clean `v1.6.7-beta6` fidelity release. Its purpose is to record what Chromium itself has loaded while the crawler traverses a ChatGPT `/share/...` page, so those browser snapshots can be compared with the crawler's static HTML and independently saved browser MHTML files.

The MHTML instrumentation is intentionally **not** part of the clean beta6 release and is expected to be removed again after the diagnostic comparison. Findings from these captures are candidates for beta7.

## Where diagnostics are written

Each Playwright share-page session creates a directory beside the setup/start scripts:

```text
mhtml-diagnostics/
└─ dev-<timestamp>-<authenticated-or-anonymous>-<sequence>/
   ├─ manifest.jsonl
   ├─ 0001-...-initial-loaded.mhtml
   ├─ 0002-...-material-dom-change.mhtml
   ├─ 0003-...-lazy-resource-loaded.mhtml
   ├─ ...
   └─ ...-context-closing.mhtml
```

`mhtml-diagnostics/` is ignored by Git and is not included in release ZIP source archives.

## What is recorded

The dev wrapper instruments Playwright Chromium pages whose URL is a ChatGPT `/share/...` URL. This applies to both crawler modes:

- **Authenticated** — the persistent `./browser-profile` context;
- **Anonymous** — the clean disposable Chromium context.

For an instrumented page it records:

- an initial MHTML after the share page is loaded;
- a full MHTML every 10 seconds while the page remains open;
- MHTML snapshots when the mounted DOM materially changes, sampled once per second and rate-limited to avoid pathological duplication;
- MHTML snapshots after relevant lazy network resources such as ChatGPT backend images/fetch/XHR or OAI-hosted resources finish loading, also rate-limited;
- a final MHTML immediately before the Playwright context is closed.

The material-DOM signature includes mounted turn count/boundaries, scroll height, visible text length, `<pre>`/`<code>` counts, image/SVG/iframe/app-block counts, and collapsed/expanded disclosure counts.

The capture mechanism is Chromium DevTools Protocol `Page.captureSnapshot` with `format: "mhtml"`. The normal crawler continues to run unchanged underneath the diagnostic wrapper.

## Manifest

`manifest.jsonl` contains one JSON object per attempted MHTML capture. Entries include the capture reason, timestamps, browser mode, source URL, mounted turn boundaries, scroll height, pre/code/app-block counts, output filename, byte size, and any capture error.

This makes it possible to identify the browser state around a particular lazy-load or disclosure-hydration event without opening every MHTML file first.

## How to use it for the next comparison

1. Keep the existing `browser-profile/` if you want to test authenticated behavior.
2. Run beta6-dev normally with the platform start script.
3. Archive the same conversation in **Authenticated** mode.
4. If useful, run the same URL again in **Anonymous** mode.
5. Let the crawl finish normally.
6. Upload:
   - the generated crawler HTML;
   - the relevant `mhtml-diagnostics/dev-.../manifest.jsonl`;
   - preferably the whole corresponding diagnostic folder, or at least the MHTML files around suspicious turns/events;
   - any manually saved browser MHTML you want used as an independent reference.

For a very long crawl, the diagnostic folder can become large. If uploading the whole folder is inconvenient, the manifest can be used to select the snapshots around the turn or phase where content disappears.

## Privacy / security warning

Authenticated MHTML snapshots can contain private conversation content, signed resource URLs, account-visible UI, attachment metadata, and other material exposed to the logged-in browser session. Treat the entire `mhtml-diagnostics/` directory as sensitive. Do not publish it or commit it to Git.

The recorder does not intentionally export the `browser-profile/` itself or enumerate cookie values, but an MHTML capture should still be treated as private browser-session output.
