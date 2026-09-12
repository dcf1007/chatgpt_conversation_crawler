# v1.7.1-beta3-dev

This development diagnostic prerelease replaces beta2.1's geometry/presentation-coupled convergence assumptions with a semantic-evidence fixed-point model while preserving the validated identity-based retained-turn navigator and archive-fidelity pipeline.

## Semantic state model

- `turnRevision` now advances only when retained semantic evidence grows.
- Newly observed poorer subsets and disclosure presentation changes do not invalidate a completed turn/disclosure proof.
- Physical DOM generations remain recorded separately for hydration diagnostics.
- Retained unresolved disclosure counts are derived from logical disclosure keys whose completion proof is absent or older than the current semantic turn revision; retained `remaining` is presentation telemetry only.
- Capture is observational: native `<details>` elements are opened only on the detached archive clone, never on the live ChatGPT page.

## Disclosure proof

- A click is confirmed only by a stable positive observation that the physical control is still present, expanded, and exposes its target.
- Virtualizer disappearance/remount is not treated as expansion success.
- After confirmed exposure and capture, the logical disclosure is completed at the resulting semantic revision even when the activation produced richer retained content.
- A same-revision collapsed remount is suppressed; genuinely newer semantic evidence makes the same logical disclosure actionable again.

## Retention guarantees

- Turns already mounted when retention is installed are captured immediately.
- Mutation records retain the concrete observed turn node, allowing a mount-and-detach in one task to survive virtualization.
- Targeted semantic attributes such as `href`, `src`, `aria-label`, `data-math-source`, and message metadata trigger owning-turn recapture.
- Mount retention is drained and sealed before final semantic closure so no asynchronous observer can mutate the retained corpus after convergence is declared.

## Whole-turn coverage and traversal

- Short turns are placed wholly within a guarded viewport where possible.
- Tall turns use guarded start, overlapping interior bands, and guarded end based only on current live geometry.
- Passive traversal convergence is semantic: scroll position, scroll height, viewport size, clicks, and presentation-only disclosure state do not own convergence.
- Exact endpoints use `setTop()` only. Assisted `navigateTop()` remains available for non-endpoint movement and retained-turn recovery.
- Once an endpoint is reached, geometry can be re-pinned without resetting semantic quietness.
- The old alternate global mounted-range expansion scan is removed from supported behavior; the compatibility `scan()` export now uses the same passive semantic endpoint primitive.

## Beta3 orchestration

The automatic pipeline is now:

1. exact top;
2. forward passive discovery;
3. reverse passive discovery;
4. oldest-edge semantic verification;
5. process every retained turn to its turn-local guarded coverage/disclosure fixed point;
6. forward remount verification;
7. targeted revalidation of turns whose semantic revision changed, whose logical disclosure proof is stale, or which have not yet been processed;
8. final mount-retention drain and seal, followed by targeted processing of any newly retained semantic work;
9. conditional reverse closure only when semantic work changed during forward closure;
10. logical retained-disclosure reconciliation;
11. truthful final convergence/integrity status.

A bounded logical work queue replaces the fixed three-batch retained-turn discovery assumption.

## Development diagnostics

Manual diagnostic reconvergence now invokes the same target-turn production fixed-point primitive instead of global mounted-range expansion. Diagnostic target priority uses actionable logical disclosure proof rather than retained presentation `remaining`.

## Regression coverage

Beta3 adds browser-backed runtime regressions for:

- first-seen poorer semantic generations not advancing semantic revision;
- observational native-details capture;
- presentation-only `aria-expanded` changes not advancing semantic revision;
- attribute-only semantic hydration;
- same-task mount/detach retention;
- giant penultimate content followed by a tiny `Great` user turn and tiny final assistant turn at 1000px and 4000px viewport heights;
- semantic endpoint convergence under physical bottom-height churn;
- exact endpoints never being routed through adaptive `navigateTop()`;
- completion at the resulting semantic disclosure revision.

## Deliberately deferred

Beta3 does not guess away the remaining hydration-conflict population or redesign logical disclosure identity without evidence. Those evidence-first items, app-block transient-capture stress work, ordinary-turn canvas fidelity, UI/progress refinements, and release-workflow immutability cleanup are candidates for beta4.

## Scope

This remains a development diagnostic prerelease on `dev`. Clean `main` is not promoted or modified by beta3.
