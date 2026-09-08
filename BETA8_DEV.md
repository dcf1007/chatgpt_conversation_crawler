# beta8-dev: turn-scoped disclosure convergence

`v1.6.7-beta8-dev` is the performance-focused development revision after the dev2.4 fidelity run.

The dev2.4 artifacts showed that the successful-disclosure retry reset and retained-corpus reconciliation fixed the known fidelity gap: the automatic baseline already contained the rich turn-54 and turn-38 states that previously required manual expansion. The same run exposed a separate performance/control-flow defect: disclosure quiescence was defined over the entire mounted virtualized conversation range.

## Root cause of the dev2.4 stalls

During the observed `Waiting for nested disclosures · 1/3 quiet rounds · actionable 0` stall, no disclosure subtree was changing. An unrelated boundary turn was repeatedly mounting and unmounting as ChatGPT adjusted its virtualized viewport. Because beta7/dev2.4 included every mounted turn's text/HTML/pre/code/media/child metrics in the quiescence signature, that unrelated churn continually reset the three quiet rounds. A small manual scroll changed the virtualizer anchor and allowed the signature to repeat.

That was the wrong authority boundary: nested-disclosure completion is a property of the turn whose disclosure was activated, not of every conversation turn that happens to be mounted nearby.

## beta8 convergence model

After a disclosure is activated, beta8 records its `conversation-turn-*` ID and waits only on that turn. The turn-scoped signature contains:

- that turn's text and HTML length;
- `<pre>` and `<code>` counts;
- media and descendant counts;
- recognized collapsed disclosure identities;
- actionable recognized disclosure identities;
- closed native `<details>` count.

Unrelated turns are intentionally absent. A plain user message can therefore oscillate in/out of the virtualizer without resetting a nested-disclosure quiet round.

The automatic loop remains a fixed-point loop:

1. find one recognized disclosure and make its turn the active convergence scope;
2. while that turn is active, `expandOne(turnId)` is restricted to that turn so another mounted message cannot steal the loop;
3. wait for the clicked disclosure's controlled target/turn hydration to stabilize;
4. capture only the richer active turn at per-expansion checkpoints;
5. rescan that same turn for descendants;
6. when no descendant is actionable, take turn-scoped samples;
7. require three identical quiet rounds for that turn;
8. if a descendant appears, start a new expansion generation and repeat;
9. once the turn converges, return to the mounted-range search for another turn that needs expansion.

There is still no nesting-depth limit. An 8-second turn-scoped safety limit prevents animation/virtualizer behavior inside one turn from blocking traversal forever; the richest retained state is preserved and later passes/reconciliation can revisit it.

When no disclosure has yet been activated at a viewport position, beta8 does not perform expensive whole-DOM stabilization. It takes two lightweight disclosure-only samples separated by 180 ms. These samples track recognized disclosure identities only, so ordinary virtualizer mount churn is ignored while lazily mounted roots still get a rescan opportunity.

Per-expansion retention is also narrowed to the active turn. Full mounted-range retention still occurs once at every traversal position, so timeline/turn coverage is unchanged, but a single nested disclosure no longer causes every neighboring mounted turn to be cloned repeatedly while that disclosure hydrates.

## Directional and reconciliation performance

The same authority correction is applied to traversal endpoints. Six endpoint observations and the twelve-check oldest-edge proof still exist, but their progress signature now uses scroll geometry plus **retained** richness/coverage and expansion counters. `mountedFirst`/`mountedLast` remain visible diagnostics; they no longer invalidate convergence merely because an unrelated virtualizer boundary message mounted or unmounted.

## Reconciliation performance

Retained-corpus reconciliation remains a fidelity safety net, but its redundant work is reduced:

- maximum reconciliation traversals are reduced from four to two;
- one complete traversal with an unchanged retained fingerprint is sufficient to stop;
- the redundant post-scan `expandMounted + whole-mounted stabilization` sequence is removed, because every scan position already performs disclosure convergence and capture.

If the first reconciliation pass improves retained state, beta8 can run one opposite-direction pass. If a complete pass changes nothing, repeating the same corpus scan again is no longer required.

## Source cleanup

The old orchestration code embedded in `crawler-base.mjs` was obsolete after beta7 introduced its own core. beta8 removes that duplicate traversal/expansion implementation. `crawler-base.mjs` now contains only the page-side authority primitives used by the current crawler: retention, one-disclosure activation, disclosure hydration sampling, scroll metrics, and capture metadata.

The version-specific `crawler-beta7-core.mjs` name is also retired. Current automatic traversal policy now lives in `src/crawler-core.mjs`, and `src/crawler.mjs` remains the thin development/manual wrapper.

The stale beta7 development document is replaced by this beta8 document.

## MHTML diagnostics intentionally unchanged

The dev2.4 high-frequency MHTML timeline was large, but it was also what made the unrelated virtualizer oscillation diagnosable. beta8 therefore does **not** reduce `material-dom-change`, `lazy-resource-loaded`, manual-interaction, initial, closing, or existing idle-safety MHTML capture.

This revision is intended to measure crawler performance independently of any MHTML reduction. The recorder remains development-only.

## Manual comparison remains

Authenticated development runs still perform the two-step manual comparison after the automatic crawler completes. Turn 54 remains the known first target and the independent second target remains available to detect an automatic/manual richness gap. Manual diagnostic failure still salvages the completed automatic/partial retained archive.

## Background execution

The headed Playwright Chromium background protections remain unchanged:

- `--disable-background-timer-throttling`
- `--disable-backgrounding-occluded-windows`
- `--disable-renderer-backgrounding`

The standalone unmanaged Chromium login process remains unchanged for Google/SSO compatibility.

## What to compare in the beta8 run

The useful comparisons against dev2.4 are:

- total automatic-crawl elapsed time;
- whether `Waiting for nested disclosures` ever remains on one quiet round while `actionable 0` for minutes;
- automatic turn-54 richness before manual interaction;
- second-target automatic/manual richness;
- total expansions, `<pre>` and `<code>` retained;
- reconciliation pass count and unresolved retained IDs;
- the unchanged high-frequency MHTML timeline around any remaining stall.
