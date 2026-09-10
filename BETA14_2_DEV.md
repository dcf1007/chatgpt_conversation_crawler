# v1.6.7-beta14.2-dev

Development-only follow-up to beta14.1-dev. This build keeps the beta14 disclosure fixed-point behavior, moves the virtualizer navigation correction into the permanent crawler core, and strengthens the page-activity protection after beta14.1 again exhibited an apparent background/focus stall.

## Why beta14.2 exists

Beta14-dev showed that disclosure convergence could terminate while retaining the same rich turn content later reproduced manually. It also exposed a manual remount loop in which the virtualized viewport repeatedly lost useful progress while locating `conversation-turn-14`.

Beta14.1-dev corrected the diagnostic scroll assist so downward progress was judged by the leading/minimum mounted turn rather than a pinned newest turn such as `conversation-turn-120`, and reset the directional baseline after a reversal. That correction was still installed only after the automatic crawl, which meant the automatic traversal could not benefit from it. During the next attempted beta14.1 run the headed page again appeared to stall when it was not kept foreground-active, showing that a one-shot focus-emulation command was also not sufficient as the permanent scheduling boundary.

## Permanent core navigation

Beta14.2 adds `src/crawler-navigation.mjs` and installs it from `crawler-core.mjs` before automatic traversal begins. The same `crawler.setTop()` authority is therefore used by normal automatic scans, oldest-edge probing, retained-disclosure reconciliation, and the later manual diagnostic remounter.

The core navigation state follows the progress rules established by the previous diagnostics:

- downward progress is established when the leading edge of the active virtualized viewport advances to a later conversation turn;
- upward progress is established when that leading edge retreats to an earlier turn;
- if one very tall turn remains the leading turn across multiple viewports, its measured movement through the viewport also counts as progress so the crawler does not jump over legitimate content inside the turn;
- reversing direction starts a new baseline rather than inheriting an obsolete high-water mark;
- a coordinate change without either logical-edge progress or same-turn viewport motion is stagnation, not progress;
- after repeated same-direction stagnation the requested displacement is amplified and clamped to the actual scroll range.

The progress edge is taken from the active viewport intersection, not simply from every mounted section in the document. That prevents distant retained/sentinel turns and a pinned newest turn from corrupting the progress signal.

The development manual phase no longer installs or removes a separate scroll-assist wrapper. It automatically inherits the same permanent core navigation behavior as the automatic crawler. This is intentional: when the MHTML/manual wrapper is eventually removed, the navigation correction remains in the production crawler.

## Permanent page-activity protection

Foreground-equivalent Chromium behavior is also now owned by the crawler core rather than `crawler.mjs`'s development wrapper. Existing Chromium launch flags remain unchanged. The authenticated session manager now imports Chromium explicitly from `runtime-browser.mjs` rather than directly from Playwright, so persistent authenticated contexts no longer depend on an implicit shared-prototype patch order for the background-protection launch arguments.

The page-level CDP state now best-effort applies all of the following to the actual capture page:

- `Emulation.setFocusEmulationEnabled` with focus emulation enabled;
- `Emulation.setIdleOverride` with the user active and screen unlocked;
- `Page.setWebLifecycleState` with lifecycle state `active`;
- `Page.bringToFront` to keep the capture tab active inside the crawler browser.

The state is reasserted at every automatic scan boundary. If the core navigation controller records two or more genuine same-direction stagnation steps, the crawler reasserts the page-active state again before continuing with assisted displacement. Unsupported experimental commands are non-fatal so the existing launch flags still provide the baseline behavior.

This is also permanent core behavior. Removing the MHTML recorder and manual comparison later will not remove the Chromium activity protection.

## Diagnostics retained for this test

The MHTML manifest now records both the strengthened activity state and the core navigation state: focus/idle/lifecycle/tab activation flags, reassertion count, logical navigation progress, active leading/trailing turns, requested and applied scroll coordinates, stagnation count, amplification count, and direction resets.

The manual comparison remains diagnostic-only and should still be used for the two regression pages. The expected result is that automatic traversal and manual target remounting share the same progress semantics, while the retained-disclosure behavior remains comparable to beta14-dev.

## Permanent changes preserved

Once the development MHTML/manual wrapper is removed, beta14.2 is intended to retain all substantive crawler changes accumulated in this line: Chromium background launch protection, page-level foreground/activity protection, mount/hydration retention, turn-scoped disclosure identity, progress-verified disclosure fixed-point convergence, retained-corpus reconciliation, and core virtualizer progress assistance.

## What to test

Run both diagnostic conversations. Preserve the complete MHTML diagnostics, two-step manual-inspection directory/archive, and final rebuilt HTML from each run. Do not manually rescue scrolling unless it is clearly stuck long enough to produce diagnostic evidence. The comparison should focus on automatic traversal liveness, core navigation stagnation/amplification, foreground reassertions, disclosure generations, unresolved retained disclosures, manual remount step counts, and retained content richness.

## Release boundary

This remains a diagnostic development prerelease. Do not promote it to `main` or publish a clean release until both beta14.2 acquisitions are compared against the previous versions.
