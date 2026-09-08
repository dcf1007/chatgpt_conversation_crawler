# v1.6.7-beta11-dev — diagnostic wrapper for beta11

This branch/package is a **development-only diagnostic wrapper** around the exact beta11 automatic crawler. It is intentionally kept separate from clean `main` and must not be merged into the clean release branch.

## Purpose

Use this build only when a matched anonymous/authenticated diagnostic run is needed. It restores the proven beta10-dev diagnostic instrumentation around beta11 so the automatic crawler can be checked empirically without changing beta11's crawl, retention, image/app, formula, traversal, or archive-building algorithms.

## What is unchanged from clean beta11

The following production files and automatic behavior are inherited directly from clean beta11:

- `server.mjs` archive/API implementation;
- `src/crawler-core.mjs` automatic crawler;
- beta11 remount and descendant-hydration retention;
- beta11 media/app-aware retained-turn richness;
- transient timeline/app/image retention;
- explicit `stage` and backend-owned progress limits;
- canonical archive identifier `id`;
- image/app/formula/fidelity finalization;
- authenticated and anonymous modes using the same automatic crawler.

The development facade runs the automatic crawler first. Manual work is observational and happens only afterward.

## Development-only additions

- `server-dev.mjs` loads common Chromium runtime behavior, enables manual inspection, installs the MHTML hook, then imports the normal beta11 `server.mjs`.
- `src/mhtml-dev-hook.mjs` records event-driven and idle-safety MHTML snapshots for the selected share page.
- `src/mhtml-recorder.mjs` serializes Chromium `Page.captureSnapshot` calls into `mhtml-diagnostics/`.
- `src/manual-inspection.mjs` performs the two-target authenticated human comparison after automatic capture completes.
- `src/crawler.mjs` is only a facade: it delegates automatic crawling to `crawler-core.mjs`, then conditionally runs manual diagnostics.

Anonymous mode receives automatic beta11 crawling plus MHTML diagnostics and skips the human comparison. Authenticated mode receives the same automatic beta11 crawl plus MHTML diagnostics, then the two manual targets.

## MHTML policy

The MHTML recorder keeps the beta10-dev evidence policy:

- initial loaded snapshot;
- material DOM-change captures, rate limited;
- lazy image/fetch/XHR resource captures, rate limited;
- manual-inspection state changes;
- 10-second periodic capture only when no event-driven capture has occurred for a full interval;
- final context-closing capture.

Manifest records use `diagnosticId`, not the archive API's retired `jobId` alias.

## Manual validation

In the authenticated run, after automatic capture has completed, the development facade ranks the untouched automatic corpus and selects two independent rich assistant turns. For each highlighted target:

1. fully expand every nested reasoning/tool disclosure;
2. wait for leaf content to load;
3. click **This turn is fully expanded** in the overlay;
4. allow the automatic turn-scoped convergence to run again.

Outputs are stored under `manual-inspection-diagnostics/` and include the untouched automatic baseline, per-target post-human snapshots, the final post-manual snapshot, and `summary.json`.

## Session-check UI lifecycle fix

The beta11-dev local UI polls fresh `/api/session/status` state while a login window, interactive session-check window, or profile owner is active. This prevents the controls from remaining disabled after a manually closed **Check session** Chromium window. The refresh is guarded so overlapping one-second status requests cannot accumulate. This is a branch-only diagnostic-package fix; no clean beta11 release is created or modified.

## Recommended matched run

Run the same share URL twice:

### 1. Anonymous

- select **Anonymous**;
- run to completion;
- save the static HTML;
- preserve the corresponding `mhtml-diagnostics/<run>/` directory.

### 2. Authenticated

- verify the saved ChatGPT session;
- select **Authenticated**;
- run to completion;
- complete both highlighted manual-validation steps when prompted;
- save the final static HTML;
- preserve the corresponding `mhtml-diagnostics/<run>/` directory;
- preserve the matching `manual-inspection-diagnostics/` directory.

Do not include `browser-profile/` when sharing diagnostics.

## Evidence to compare

The main beta11 validation target is the previous authenticated uploaded-image gap: the beta10 MHTML proved four upload-image elements and their bytes were browser-visible while the final retained user-turn HTML lost those elements. A beta11-dev matched run should check whether those image elements are now retained in their actual user turns.

The same evidence should also be checked for:

- all observed/retained turns and timeline markers;
- disclosures and rich pre/code payloads;
- app-preview frames/resources and static app blocks;
- uploaded/generated image DOM and retrievable bytes;
- signed/blob URLs;
- filenames/labels actually exposed by ChatGPT;
- formulas, SVGs and embedded resources;
- manual-before/after differences for the two selected rich turns.

## Start commands

The platform launchers intentionally start `server-dev.mjs` in this development package. `npm start` also points to `server-dev.mjs`.

The clean beta11 release remains on `main` and continues to start `server.mjs` directly.
