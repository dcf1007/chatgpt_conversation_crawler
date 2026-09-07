# beta7-dev2.4 retained-disclosure reconciliation diagnostic

`v1.6.7-beta7-dev2.4` keeps the sparse-aware manual target remounting, single MHTML recorder, two-step manual comparison, partial-capture salvage, and headed-Chromium background protections from dev2.3. It changes the automatic crawler where the dev2.3 MHTML timeline identified the remaining disclosure-loss mechanism.

## Root cause found from dev2.3

The crawler keys disclosure retry state by turn, `aria-controls`, and label. A logical disclosure could be opened successfully on one virtualizer mount and later remount collapsed. Before dev2.4, a successful confirmation incremented the success count but did **not** clear that disclosure's attempt counter.

After the same logical disclosure accumulated three successful activation attempts across earlier mounts, a later collapsed remount could therefore be recognized while already carrying `attempts=3`. The beta7 diagnostics then reported it as recognized but non-actionable. This matches the dev2.3 MHTML evidence immediately before the human root-disclosure clicks on turns 54 and 38.

In dev2.4, a successful confirmation clears both the transient failure and its attempt counter. The three-attempt limit remains intact for a genuinely failing activation; it is no longer a lifetime cap across successful virtualizer remounts.

## Retained-corpus reconciliation

Mounted-DOM quiescence alone cannot prove the retained conversation is complete because ChatGPT may virtualize away a turn and later remount its root disclosure collapsed. The automatic crawler now performs a retained-corpus reconciliation after the established three traversals.

The reconciliation uses each richest retained turn's `remaining` count as the authority for unresolved recognized disclosures:

1. Inspect all retained turns after pass 3.
2. If no retained turn has a recognized collapsed disclosure, reconciliation is already complete.
3. Otherwise, perform another full traversal so those turns remount with the corrected retry bookkeeping.
4. Alternate downward and upward reconciliation traversals so neither virtualizer edge is privileged.
5. Continue mounted fixed-point expansion and hydration during every reconciliation traversal.
6. Recompute the retained unresolved corpus after each traversal.
7. Stop when the retained unresolved count reaches zero, or after bounded no-progress/safety limits.

The dev diagnostics expose retained unresolved turn/disclosure counts, representative turn IDs, reconciliation pass count, stability count, and convergence state. These fields are also included in MHTML material-change detection so the next run can align reconciliation progress directly with browser snapshots.

## Two-step manual validation remains

The manual diagnostic remains intentionally independent so dev2.4 can be tested against the same human baseline:

1. Automatic traversal plus retained-corpus reconciliation completes.
2. Save `automatic-before-manual.html`.
3. **Step 1:** remount and highlight `conversation-turn-54`.
4. Fully expand every nested layer and click **Turn 54 is fully expanded — continue to step 2**.
5. Save the human-only checkpoint, then run automatic fixed-point reconvergence.
6. Select a second diagnostic target excluding turn 54.
7. Remount it with the sparse-aware dev2.3 algorithm, fully expand it, and click **Finish manual inspection**.
8. Save the second human checkpoint, reconverge, save `post-manual.html` and `summary.json`, then build the ordinary final archive.

If dev2.4 is working as intended, the automatic baseline should be much closer to the human checkpoints, ideally with no additional tool/code leaves exposed by the manual root activation.

## Sparse virtualizer remounting

The dev2.3 remount fix is unchanged. Manual target search uses the actual mounted turn-ID set rather than assuming `mountedFirst` through `mountedLast` is contiguous. Bracketed targets are probed forward from their nearest mounted predecessor; targets requiring a larger reacquisition use stable-top, monotonic forward sweeps. The old upward-scroll/bounce loop is not reintroduced.

## MHTML volume reduction without removing event evidence

The dev2.3 run produced many redundant clock-driven periodic MHTML files while material DOM and resource events were already being captured. In dev2.4:

- `material-dom-change` capture is unchanged.
- `manual-inspection-change` capture is unchanged.
- `lazy-resource-loaded` capture is unchanged.
- initial and context-closing captures are unchanged.
- the 10-second periodic capture is now an **idle safety net**.

Any event-driven capture request restarts the 10-second idle timer. A `periodic-10s` snapshot is written only after a full 10 seconds without another capture request, then the idle timer starts again. This preserves periodic coverage during quiet intervals without duplicating the dense event-driven timeline.

## Removed stale PNG diagnostics

The old runtime files `public/session-home-diagnostic.png` and `public/session-share-diagnostic.png` are no longer generated. Their screenshot-only code paths and `.gitignore` entries are removed, and the stale `public/session-diagnostics.html` screenshot viewer is deleted.

Authentication behavior itself is unchanged: the standalone bundled Chromium login remains unmanaged for Google/SSO compatibility, session checks still inspect cookie metadata, and Cloudflare human-verification detection still pauses in visible Chromium for manual completion.

## Background execution

The development launcher continues to apply these Chromium flags to headed Playwright persistent contexts:

- `--disable-background-timer-throttling`
- `--disable-backgrounding-occluded-windows`
- `--disable-renderer-backgrounding`

The standalone unmanaged login Chromium remains unaffected.

## Diagnostic files

Each authenticated development run creates one directory under:

`./manual-inspection-diagnostics/<timestamp>-two-step-manual-inspection/`

It contains:

- `automatic-before-manual.html`
- `after-turn-54-manual-before-reconvergence.html`
- `after-preferred-turn-manual-before-reconvergence.html`
- `post-manual.html`
- `summary.json`

The MHTML recorder writes its separate run under `./mhtml-diagnostics/`. A single archive page should still create only one MHTML diagnostic directory.

Both diagnostic directories may contain private ChatGPT content and signed resource URLs. They are ignored by Git and must never be committed or shared unintentionally. `./browser-profile/` remains separate and must never be uploaded.
