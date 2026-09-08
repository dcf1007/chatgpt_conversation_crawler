# v1.6.7-beta10-dev

`beta10-dev` keeps the beta9 automatic crawler architecture and focuses on two areas that had become stale after several diagnostic revisions: manual target selection and the local status interface.

## Automatic crawler behavior is intentionally unchanged

The release keeps:

- three directional passes with oldest-edge verification;
- turn-scoped nested-disclosure convergence;
- successful-disclosure retry reset after remounts;
- mount-triggered turn retention plus a deferred richness retry;
- retained-corpus disclosure reconciliation;
- app-block, formula, SVG, image and timeline-marker fidelity logic;
- the existing high-density MHTML development recorder;
- background-renderer protection for headed authenticated Chromium.

## Dynamic manual regression targets

The previous development selector overvalued arbitrary `aria-expanded=false` controls, which let image-viewer controls such as `Open image 1 of 3` outrank a much richer reasoning/tool turn.

`beta10-dev` selects both manual validation targets from the untouched automatic retained corpus before the human phase starts. Generic collapsed UI controls do not contribute target priority.

Ranking prefers, in order:

1. assistant turns with recognized unresolved reasoning/tool disclosures;
2. assistant turns containing reasoning labels such as **Worked for**, **Thought**, **Thinking**, or **Reasoning**;
3. assistant turns with substantial `<pre>` / `<code>` content;
4. other assistant turns as a fallback;
5. non-assistant rich turns only when necessary.

The two targets are therefore portable to unrelated conversations. No turn ID is hard-coded as a regression fixture.

## Status interface cleanup

The main interface now separates the current operation from crawler diagnostics:

- **Stage** describes the current major phase.
- **Current action** is one concise description of what the crawler is doing now.
- **Coverage** reports retained turns against every turn ID the mount observer has actually seen and prominently reports any observed-but-unretained turn.
- **Oldest retained** remains visible.
- **Position in loaded content** reports the raw scroll position inside ChatGPT's currently loaded scroll range. It is explicitly not presented as overall archive completion.
- **Disclosure activity** is shown only while disclosure work is active.
- **Worker heartbeat** and **Last substantive progress** remain permanently visible.

The duplicated `Scanning`, `Mounted first`, separate click/confirmed-expansion tiles, separate pre/code tiles, and explanatory status duplication are removed.

Progress bars are stage-local:

- directional traversal uses progress through the current pass;
- oldest-edge verification uses stable top checks out of twelve;
- reconciliation uses the current reconciliation traversal;
- loading and final assembly are indeterminate;
- no progress bar is shown while the diagnostic build is waiting for human input.

The interface no longer derives its stage from `scanComplete`, so manual validation cannot incorrectly appear as `Finalizing archive`.

## Substantive progress semantics

`Last substantive progress` now tracks durable archive-state changes. Virtualizer-only `mountedFirst` / `mountedLast` movement and scroll-height growth no longer reset that timestamp.

A 30-second no-substantive-progress warning is suppressed while the development build is explicitly waiting for a manual validation click. Worker-heartbeat warnings remain active.

## Archive header cleanup

The final static archive now reports one **Disclosures expanded** field instead of permanently showing both `Expansion clicks` and `Confirmed expansions` when they are identical. If click attempts and confirmations differ, the single field reports both numbers so retries remain visible.

## Common Chromium startup

Background-throttling protection is capture behavior, not a diagnostic feature. It is now installed from a common runtime bootstrap before any development MHTML instrumentation wraps Playwright launch methods. This lets the following clean `beta10` build remove diagnostics without losing minimized/occluded-window protection.

## Diagnostics intentionally retained here

`beta10-dev` still records the same high-density Chromium MHTML sequence and still runs the two-turn manual validation after an authenticated automatic crawl. Anonymous automatic crawling uses the same crawler routines but skips the human validation phase.

The immediately following `v1.6.7-beta10` release removes the MHTML recorder and manual validation runtime entirely while retaining the same automatic crawler and cleaned status interface.
