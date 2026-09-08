# v1.6.7-beta11-dev — diagnostic wrapper

This build exists only to validate beta11 against a real ChatGPT share with the same high-density evidence used during the beta10-dev investigation. It is based on the exact beta11 automatic crawler and archive builder. The diagnostic layer is added around that crawler; it does not replace the beta11 traversal, retention, disclosure, transient-context, image, app-block, formula, SVG, or finalization logic.

## What is added

- `server-dev.mjs` starts the normal beta11 server after preloading the MHTML instrumentation.
- Chromium share pages are recorded under `mhtml-diagnostics/` using event-driven snapshots plus a 10-second idle safety snapshot.
- The authenticated run performs the same two-step manual comparison used by beta10-dev after the untouched automatic crawl has completed.
- Anonymous mode records the automatic crawl and MHTML evidence but skips the human comparison.
- The clean `server.mjs` remains present and unchanged so the diagnostic wrapper can be compared directly with beta11.

## How to run the matched test

Use the same share URL for both runs.

1. Extract this package into its own folder.
2. Run the normal setup script once for your platform.
3. Start the crawler with the platform start script. In this dev package those launchers intentionally invoke `server-dev.mjs`.
4. Run **Anonymous** first and download the completed static HTML.
5. Run **Authenticated** with the saved ChatGPT profile and download the completed static HTML.
6. During the authenticated run, after automatic capture finishes, the headed ChatGPT window will highlight two crawler-selected rich turns one at a time. Fully expand every nested reasoning/tool layer in the highlighted turn, wait for leaf content to finish loading, then click **This turn is fully expanded** in the overlay.
7. Do not copy or zip the diagnostic directories until the archive reports completion; the final context-closing MHTML record is written when the browser context is closed.

## Files to send back

Please provide all of the following from the same beta11-dev package and the same share URL:

- the Anonymous static HTML;
- the Authenticated static HTML;
- the complete Anonymous folder under `mhtml-diagnostics/`;
- the complete Authenticated folder under `mhtml-diagnostics/`;
- the Authenticated `manual-inspection-diagnostics/` folder, including `automatic-before-manual.html`, the two per-target snapshots, `post-manual.html`, and `summary.json`.

Zip each diagnostic directory before uploading it. Do **not** include `browser-profile/`; it is credential-equivalent local state and is not needed for analysis.

## What this run is intended to establish

The matched evidence should answer, with beta11 rather than beta10:

- whether all 60 conversation turns and timeline/branch markers are retained;
- whether the four authenticated uploaded-image elements remain represented inside their final user turns rather than only in the image cache;
- whether the authenticated app block is retained and flattened while the anonymous view still receives only the source resources ChatGPT exposes publicly;
- whether resource exposure differences for uploaded images, files, app sandboxes, tool payloads, signed URLs, blob URLs, SVG, and formulas remain the same;
- whether beta11's synchronous remount/hydration retention and media-aware richness ordering prevent later rich generations from being displaced by poorer retained copies;
- whether the automatic beta11 result already equals or exceeds the two human-expanded diagnostic targets.

## Isolation boundary

`v1.6.7-beta11-dev` is diagnostic-only. It must not replace `v1.6.7-beta11` as the clean release. The dev branch intentionally contains MHTML/manual-inspection code and dev launchers; `main` remains the clean beta11 source.
