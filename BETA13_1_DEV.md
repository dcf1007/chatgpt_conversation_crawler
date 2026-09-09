# v1.6.7-beta13.1-dev

Development-only correction for the beta13 semantic-liveness implementation. This build remains diagnostic/pre-release and must not be promoted to `main` until the real giant-conversation run is reviewed.

## What beta13.1-dev changes

Beta13.1 keeps beta12 fidelity/retention behavior and beta13's semantic convergence direction, but fixes the scope of the liveness memory:

- disclosure completion state now persists page-side across separate `expandMounted()` calls;
- retained progress is tracked per turn, so progress in `conversation-turn-64` cannot make completed work in `conversation-turn-62` eligible again;
- a logical disclosure may be reopened after virtualization only when that same retained turn became richer since the disclosure last completed;
- reopening a disclosure and finding no richer retained generation records completion at the current turn revision, suppressing further remount churn at that revision;
- logical disclosure identity is independent of React `aria-controls` identity and uses the turn, normalized label, disclosure kind, and same-label occurrence;
- mounted quietness is based on the remaining actionable logical worklist, not volatile mounted membership;
- beta13's bounded null/actionable contradiction and semantic timeout behavior remain in place.

## Target regression

The primary regression is the observed giant-turn loop that alternates between turns 62 and 64 even after beta13 locally yields. Beta13's `successfulLogicalKeys` lived only inside one `expandMounted()` invocation, so the next traversal step forgot the prior completion and could restart the same disclosure cycle. Beta13.1 moves that memory into the page-side crawler state and scopes retained revisions to each turn.

## Expected behavior

On the known authenticated giant conversation, traversal may revisit turns 62 and 64 while real retained content is still improving. Once the logical disclosure worklist for a turn has been completed at its current retained revision, virtualizer remounts of those same disclosures must not restart the cycle. Traversal should continue past the region and finish normally.

MHTML and manual-inspection diagnostics remain available. Preserve the diagnostic result from the first beta13.1 real-world run whether it succeeds or fails so the turn-62/64 sequence can be compared with beta12 and beta13.
