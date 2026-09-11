# v1.7.1-beta-dev

This development diagnostic prerelease corrects the navigation, turn-convergence, hydration-generation, and integrity behavior exposed by the complete `v1.7.0-beta3-dev` regression batches. It does not add a new archive-content capability or broaden the crawler's product scope.

## Turn-first crawl and convergence

- The automatic crawler performs an initial capture-only downward discovery sweep to retain turn identities/order before turn-local processing.
- Every retained turn is then processed by identity rather than by a historical page pixel.
- Short turns are observed at their current start/end boundaries. Turns taller than the viewport are covered through overlapping bands computed from the turn's current live geometry, so lazy content in the middle of a tall turn can hydrate before convergence is accepted.
- Disclosure expansion is scoped to the active retained turn. Neighboring mounted turns cannot steal the expansion loop.
- A turn is covered again after disclosure expansion because expansion can change both its height and the content that becomes lazy-load eligible.
- One reverse and one forward capture-only verification sweep detect semantic revisions without blindly reopening already-converged disclosures.
- Retained-disclosure reconciliation targets only the retained turn IDs still reporting unresolved recognized disclosures; it no longer starts another generic whole-conversation expansion scan.

## Logical target navigation

- Shared retained-turn navigation now persists only logical predecessor/successor identities and retained-order indices.
- Historical `scrollTop` values are no longer stored as turn anchors. A predecessor that is mounted off-screen can therefore never acquire the current viewport's unrelated pixel coordinate.
- When a logical anchor is currently mounted, the crawler re-resolves the live DOM element and positions it using current geometry.
- Targeted fallback movement is bounded and current-relative. It does not feed a stale recovery coordinate into adaptive `navigateTop()` amplification.
- Manual diagnostic target remounting uses the same core retained-turn navigator. The old independent sweep/probe/stale-pixel recovery implementation is removed.
- Exact `setTop()` and assisted `navigateTop()` remain distinct. Endpoint and oldest-edge positioning retain exact semantics.

## Hydration-generation reconciliation

- Preservation units and observed-generation authority are now separate concepts.
- `canonicalObserved` always represents one real DOM generation that actually existed.
- `evidenceFacts` accumulates multiset-aware semantic evidence observed across real generations.
- A synthetic HTML/content-unit union may still be retained when incomparable generations contain unique material, so observed content is not discarded, but that synthetic union is never treated as a later observed DOM generation.
- Progressive enrichment such as unchanged prose gaining a link can dominate the earlier generation instead of becoming an impossible permanent conflict.
- A genuine incomparable conflict remains flagged and preserves all unique observed content. A later real generation resolves it when that real generation covers all accumulated semantic evidence.

## Integrity and diagnostics

- Turn-local processing failures are persisted into centralized archive-integrity reporting with affected turn IDs.
- Hydration-conflict warnings now describe unresolved semantic evidence across competing observed generations rather than requiring a real page generation to reproduce a synthetic retained union.
- Diagnostic automatic/manual/post-manual snapshots evaluate centralized integrity against a detached archive-state clone before snapshot assembly, so diagnostic HTML no longer has a blank integrity status merely because the normal server-side final evaluation has not run yet.
- The diagnostic wrapper remains development-only and must not be merged into the clean main release.

## Regression coverage and validation

New regressions cover:

- sparse mounted sets and logical target brackets with no persistent page-pixel anchor;
- current-geometry remounting after a virtualizer predecessor is observed away from the viewport;
- tall-turn interior lazy loading triggered only when a middle sentinel enters the viewport;
- progressive text-to-link hydration enrichment without a false competing-generation warning;
- true `A+B` versus `A+C` competing generations preserving `A+B+C`, followed by resolution on a later real `A+B+C` generation;
- turn-local and diagnostic integrity reporting;
- the existing beta1 multiset hydration/union contract unchanged.

CI now installs the Playwright Chromium binary required by the repository's existing browser-backed tests. The server integration test also has bounded child-process teardown after its HTTP assertions pass, preventing a successful archive/browser child from occupying CI indefinitely.

## Intentionally unchanged pending new evidence

The recurring unresolved disclosure on `conversation-turn-37` in the 120-turn corpus predates v1.7 and remains suspicious, but the exact live control that caused it could not be retrieved from the capped recorder-file listing with sufficient certainty. The production disclosure recognizer is therefore not special-cased by turn ID, role, or guesswork. The new targeted reconciliation path should make that turn an explicit processing subject in the next live diagnostic run; if it remains unresolved, that run will provide the evidence needed for a generic classifier correction.
