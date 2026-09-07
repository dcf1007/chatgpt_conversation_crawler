# beta7-dev2.2 two-step manual inspection diagnostic

`v1.6.7-beta7-dev2.2` keeps the beta7 fixed-point crawler, the single-recorder MHTML diagnostics, and the two-step manual inspection flow from dev2.1, while adding two safeguards discovered during the first real dev2.1 run.

## What changed in dev2.2

1. Headed authenticated Chromium is launched with Chromium's background-throttling protections enabled for Playwright persistent contexts: `--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, and `--disable-renderer-backgrounding`. This is development-only and does not alter the standalone unmanaged login browser used for Google/SSO.
2. Manual inspection is now failure-tolerant after the automatic beta7 crawl has completed. If a diagnostic-only manual step fails (for example, a selected virtualized turn cannot be remounted), the crawler retains the automatic capture plus every richer turn already exposed manually, removes the manual overlay, and proceeds through the ordinary final archive builder instead of discarding the run. Cancellation still cancels normally.

The first dev2.1 run reached the second-target remount stage and failed while trying to remount `conversation-turn-38`. The generated `automatic-before-manual.html` and `after-turn-54-manual-before-reconvergence.html` remain valid diagnostic checkpoints from that run; dev2.2 is specifically designed so an equivalent diagnostic failure no longer removes the downloadable archive.

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

If a non-cancellation manual diagnostic error occurs after the automatic crawl, dev2.2 finalizes the retained state available at that exact point. The resulting archive is intentionally a partial-manual diagnostic result, not proof that both manual steps completed.

## Diagnostic files

Each authenticated development run creates one directory under:

`./manual-inspection-diagnostics/<timestamp>-two-step-manual-inspection/`

A fully completed run contains:

- `automatic-before-manual.html` — crawler output before any manual action;
- `after-turn-54-manual-before-reconvergence.html` — state after the human finishes turn 54, before beta7 gets another chance to expand it;
- `after-preferred-turn-manual-before-reconvergence.html` — equivalent human-only state for the second target;
- `post-manual.html` — crawler output after both manual steps and final reconvergence;
- `summary.json` — both targets, before/after richness metrics, fixed-point state, and bounded event logs of manual interactions.

If a manual diagnostic fails before the flow reaches a later checkpoint, files that require that later checkpoint will naturally be absent. The normal downloadable archive is nevertheless finalized from the retained crawler state in dev2.2.

The existing `./mhtml-diagnostics/` capture remains active throughout both pauses. Its manifest records manual step number/label, target, interaction count, crawler disclosure diagnostics, and MHTML capture reasons so browser state can be aligned with each manual action.

A single archive page should create a single `mhtml-diagnostics/dev-.../` directory. Startup is guarded against concurrent `DOMContentLoaded`/`load` events and restored/stale tabs in the persistent profile are not selected as additional recorder targets.

Both diagnostic directories may contain private ChatGPT content and signed resource URLs. They are ignored by Git and must never be committed or shared unintentionally. `./browser-profile/` remains separate and should never be uploaded.

Anonymous mode remains headless and does not pause for manual inspection. This preserves the public-view crawling environment while still recording its MHTML.
