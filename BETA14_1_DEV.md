# v1.6.7-beta14.1-dev

Development-only correction to beta14-dev's manual virtualizer navigation assist. This build is intended for another pair of diagnostic captures and must not be promoted to `main` until the resulting acquisitions are compared with beta13.1-dev and beta14-dev.

## Evidence from beta14-dev

Beta14-dev successfully changed the automatic-crawl failure shape: the 120-turn giant fixture converged at 678 confirmed expansions, the sampled rich turns already matched the content recovered by later manual expansion, and page-level focus emulation remained active throughout the automatic phase.

The remaining defect was in the development-only manual target remounter. While locating `conversation-turn-14`, the manifest showed the virtualizer's newest turn (`conversation-turn-120`) remained mounted while the leading mounted turn advanced through earlier turns. Beta14-dev's scroll assist judged downward progress using the maximum mounted turn number. Because that maximum was already 120 and stayed 120, genuine forward navigation was misclassified as stagnation. The assist then amplified subsequent downward requests and created the observed scroll-down / snap-back / scroll-down oscillation.

A second part of the same bug was directional state lifetime: the assist retained an all-time downward high-water mark even after a corrective upward move. A later downward recovery leg could therefore be treated as stagnant until it exceeded an edge reached before the reversal.

## Root-cause correction

Beta14.1-dev keeps the adaptive assist but changes its progress authority to the virtualizer's leading/minimum mounted turn and scopes progress baselines to one continuous scroll direction.

- scrolling downward counts as logical progress when the minimum mounted conversation-turn number advances;
- scrolling upward counts as logical progress when that same leading edge retreats;
- a pinned newest turn no longer makes every downward request look stagnant;
- reversing direction starts a new directional baseline, so a recovery leg does not inherit an obsolete high-water mark;
- amplification is retained only for the original beta13.1 failure mode: repeated same-direction scroll requests where the leading edge actually does not move;
- the real scroll range still clamps amplified requests.

This is deliberately narrower than rewriting `remountTarget()`. The beta14 evidence shows the pathological loop was introduced by the assist's wrong progress metric and lifetime, not by the automatic crawler's normal traversal policy.

## Automatic crawler boundary

The faulty assist is installed only after the automatic crawler has completed and only for the independent manual diagnostic phase. Therefore this correction does not alter the already-converging automatic traversal, disclosure fixed-point verification, retained-turn authority, reconciliation passes, or foreground-focus protection.

The same beta14 automatic code remains in this package so the new runs can be compared directly against previous acquisitions without introducing another automatic-crawler variable.

## Regression coverage

A new executable smoke test reproduces the beta14 manifest shape with an early leading turn plus a permanently mounted newest turn. It verifies that moving the leading edge from turn 2 to turn 4 preserves the requested scroll exactly, repeated requests with an unchanged leading edge still trigger amplification, and a down/up/down recovery sequence resets its directional baseline instead of inheriting stale progress state.

## What to test

Run the same two diagnostic pages used for the prior versions. Preserve the complete MHTML diagnostics, the two-step manual-inspection archive, and the final rebuilt HTML for each page.

For the manual phase, do not rescue the second target unless the remounter is clearly stuck. The expected beta14.1 behavior is that advancing leading mounted turns reset stagnation normally and the turn-14-style down/back-up/down loop no longer appears. If true leading-edge stagnation occurs, the adaptive jump should still activate.

## Release boundary

This remains a diagnostic development prerelease. Do not publish a clean release from these changes until the new captures have been compared with the previous-version acquisitions.
