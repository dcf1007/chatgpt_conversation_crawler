# beta7-dev2.3 two-step manual inspection diagnostic

`v1.6.7-beta7-dev2.3` keeps the beta7 fixed-point crawler, single MHTML recorder, two-step manual comparison, partial-capture salvage, and headed-Chromium background-throttling protections from dev2.2.

## Why this revision exists

The dev2.1 run completed the automatic crawler and the turn-54 manual step, then failed while trying to remount the crawler-selected second target (`conversation-turn-38`). Visual observation showed Chromium repeatedly trying to scroll upward, being moved back down by ChatGPT's virtualizer, and entering a loop.

The cause was in the diagnostic remount algorithm, not in beta7's retained-turn capture. The old search treated `mountedFirst`/`mountedLast` as if every intervening turn were mounted, chose an up/down direction from the numeric midpoint of that apparent range, and judged a scroll as successful immediately after assigning `scrollTop`. ChatGPT can mount a sparse set of turns and can subsequently rewrite `scrollTop` to preserve its visual anchor, so both assumptions were unsafe.

## Remount fix in dev2.3

Manual target remounting now uses the retained turn order plus the **actual set of mounted turn IDs**:

1. If the target is already mounted, it is centered and verified after settling.
2. If mounted turns bracket the missing target (for example, turn 37 and turn 39 are mounted while turn 38 is absent), the crawler anchors the end of the nearest preceding turn and probes **forward** in small increments.
3. If all mounted retained turns are before the target, the crawler continues forward from the actual post-set position.
4. Otherwise it repeatedly asserts the real top edge until `scrollTop=0` survives virtualizer settling, then performs a monotonic top-to-bottom sweep.
5. If a coarse sweep skips the target, it restarts from the stable top with a finer forward step. It never reverses locally into the old `scroll up -> virtualizer bounces down -> scroll up again` loop.
6. Progress is judged from the scroll position and mounted-turn set **after** ChatGPT has had time to react, not from the requested position in the same JavaScript turn.
7. When forward scrolling stalls, the crawler uses the nearest mounted predecessor as a DOM anchor instead of blindly repeating the same pixel delta.

The manual-step summary now records the remount strategy, sweep/step counts, and predecessor/successor information when available.

## Two-step flow

1. The automatic beta7 crawler completes all three traversals and nested-disclosure fixed-point checks.
2. Save `automatic-before-manual.html`.
3. **Step 1:** remount and highlight `conversation-turn-54`.
4. Fully expand turn 54 through every nested disclosure and wait for each tool/code/result leaf to finish loading.
5. Click **Turn 54 is fully expanded — continue to step 2**.
6. Save `after-turn-54-manual-before-reconvergence.html`, then run beta7 convergence.
7. Re-read retained turns and select a second diagnostic target, excluding turn 54.
8. **Step 2:** remount that target with the sparse-aware forward-only remount algorithm and highlight it.
9. Fully expand the second target and click **Finish manual inspection**.
10. Save `after-preferred-turn-manual-before-reconvergence.html`, reconverge, save `post-manual.html` and `summary.json`, then build the ordinary final archive.

If the diagnostic still fails after the automatic crawl has completed, dev2.2's salvage behavior remains active: the diagnostic UI is removed, retained automatic/manual state is frozen, and the normal server finalizes a downloadable partial archive instead of discarding the job.

## Background execution

The development launcher applies these Chromium flags to headed Playwright persistent contexts:

- `--disable-background-timer-throttling`
- `--disable-backgrounding-occluded-windows`
- `--disable-renderer-backgrounding`

This is intentionally limited to the development build while minimized/background behavior is validated empirically. The standalone unmanaged Chromium login window remains unchanged for Google/SSO compatibility.

## Diagnostic files

Each authenticated development run creates one directory under:

`./manual-inspection-diagnostics/<timestamp>-two-step-manual-inspection/`

It contains:

- `automatic-before-manual.html`
- `after-turn-54-manual-before-reconvergence.html`
- `after-preferred-turn-manual-before-reconvergence.html`
- `post-manual.html`
- `summary.json`

The existing `./mhtml-diagnostics/` capture remains active throughout the run. A single archive page should create a single MHTML diagnostic directory.

Both diagnostic directories may contain private ChatGPT content and signed resource URLs. They are ignored by Git and must never be committed or shared unintentionally. `./browser-profile/` remains separate and must never be uploaded.
