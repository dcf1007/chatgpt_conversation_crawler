# v1.6.7-beta13-dev

Development-only diagnostic build for validating semantic crawler convergence against the known infinite-loop fixtures. This is not a clean release and must not be promoted to `main` yet.

## What beta13-dev changes

Beta13-dev changes crawler liveness semantics without removing beta12 retention/fidelity behavior:

- live mounted-DOM churn is no longer treated as a reason to hold disclosure quiescence below its fixed point;
- raw clicks, expansion counts, failures, and expansion-generation counters are telemetry only and no longer define traversal progress;
- a monotonic retained revision is incremented only when the existing richness authority actually replaces a retained turn generation;
- repeated successful expansion of the same logical disclosure within one convergence episode yields when it produces no newer retained generation;
- legitimate remount re-expansion remains allowed when it produces a richer retained generation;
- `expandOne() === null` plus a stable actionable disclosure state is bounded instead of retrying forever;
- the existing 8-second turn safety window measures time since semantic progress rather than time since any click.

## Primary regressions being tested

1. The historical beta7 loop that remains at `Waiting for nested disclosures · 2/3 quiet rounds · actionable 0` while unrelated mounted DOM keeps changing.
2. The beta12 giant-turn remount cycle where already-expanded disclosures are recreated collapsed and counted as fresh progress thousands of times.

## How to test

Run the development package normally:

```bash
npm install
npm start
```

Use the same authenticated giant conversation that produced the `dev12 stuck` diagnostics. MHTML diagnostics and manual-inspection diagnostics remain available through the development wrapper.

Expected result: traversal must leave the problematic turn and continue. A later traversal pass may revisit a remounted disclosure if doing so can still produce a richer retained generation. The retained archive should not lose beta12 media, app-block, uploaded-image sanitizer, reference-aware image accounting, or session-state fixes.

Do not publish this build as a clean release until the real stuck-conversation run is reviewed.
