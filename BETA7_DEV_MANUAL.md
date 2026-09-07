# beta7-dev2.1 two-step manual inspection diagnostic

`v1.6.7-beta7-dev2.1` keeps the beta7 fixed-point crawler and MHTML recorder, then adds a two-step human inspection pass for the authenticated headed Chromium browser.

## Why this revision exists

Two issues were identified before the beta7-dev2 manual pass was used:

1. `DOMContentLoaded` and `load` could race while the MHTML recorder was still starting, allowing two recorder directories to be created for one page. The development hook now serializes recorder startup and restricts recording to the same first browser page used by `server.mjs` for the archive job.
2. Manual inspection now begins with `conversation-turn-54`, the turn already proven problematic by the independent manual MHTML comparison, before moving to a separate crawler-selected diagnostic target.

## Flow

1. The automatic beta7 crawler completes all three traversals and nested-disclosure fixed-point checks.
2. The development build saves `automatic-before-manual.html`.
3. **Step 1:** Chromium is scrolled to `conversation-turn-54` and that turn is highlighted with an amber outline.
4. Fully expand turn 54 through every nested disclosure and wait for each tool/code/result leaf to finish loading.
5. Click **Turn 54 is fully expanded — continue to step 2** in the ChatGPT overlay.
6. The human-revealed turn-54 state is saved before beta7 reconverges the mounted range.
7. The retained turns are re-read and a second diagnostic target is selected, excluding turn 54. A turn with retained collapsed controls is preferred; otherwise the richest assistant/tool turn is selected.
8. **Step 2:** Chromium automatically scrolls to that second target and highlights it.
9. Fully expand the second highlighted turn through every nested layer and wait for leaf content to finish loading.
10. Click **Finish manual inspection**.
11. The crawler saves the second human-revealed state, reruns beta7 fixed-point expansion on the mounted range, saves `post-manual.html` plus `summary.json`, and then builds the ordinary final archive.

If turn 54 is unexpectedly absent from the retained automatic crawl, that fact is recorded in `summary.json` and the build proceeds to the crawler-selected target instead of silently substituting another turn for step 1.

## Diagnostic files

Each authenticated development run creates one directory under:

`./manual-inspection-diagnostics/<timestamp>-two-step-manual-inspection/`

It contains:

- `automatic-before-manual.html` — crawler output before any manual action;
- `after-turn-54-manual-before-reconvergence.html` — state after the human finishes turn 54, before beta7 gets another chance to expand it;
- `after-preferred-turn-manual-before-reconvergence.html` — equivalent human-only state for the second target;
- `post-manual.html` — crawler output after both manual steps and final reconvergence;
- `summary.json` — both targets, before/after richness metrics, fixed-point state, and bounded event logs of manual interactions.

The existing `./mhtml-diagnostics/` capture remains active throughout both pauses. Its manifest records manual step number/label, target, interaction count, crawler disclosure diagnostics, and MHTML capture reasons so browser state can be aligned with each manual action.

A single archive page should now create a single `mhtml-diagnostics/dev-.../` directory. Startup is guarded against concurrent `DOMContentLoaded`/`load` events and restored/stale tabs in the persistent profile are not selected as additional recorder targets.

Both diagnostic directories may contain private ChatGPT content and signed resource URLs. They are ignored by Git and must never be committed or shared unintentionally. `./browser-profile/` remains separate and should never be uploaded.

Anonymous mode remains headless and does not pause for manual inspection. This preserves the public-view crawling environment while still recording its MHTML.
