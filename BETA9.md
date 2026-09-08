# beta9 mount-retention completeness fix

`v1.6.7-beta9` keeps beta8's turn-scoped disclosure convergence and full development MHTML diagnostics, while fixing the short-turn retention race exposed by the beta8 result set.

## What beta8 proved

beta8 solved the disclosure-quiescence stall that had required manual scrolling in dev2.4. The known rich benchmark turns were already complete before manual inspection, and automatic runtime dropped by roughly half without reducing MHTML instrumentation.

The faster traversal exposed a separate completeness race. The automatic beta8 baseline retained only 54 turns; later manual navigation recovered four of the six missing turns, but the final archive still contained only 58 turns. MHTML showed that `conversation-turn-15` and `conversation-turn-47` had both existed in ChatGPT's live DOM. They mounted between formal crawler scroll checkpoints and virtualized away before `capture()` happened to run.

This is not a reason to restore viewport-wide stabilization. The correct authority boundary is the virtualizer mount event itself.

## Capture on mount

beta9 installs `src/crawler-mount-retention.mjs` immediately after the page-side crawler primitives.

A `MutationObserver` watches for conversation-turn sections inserted by ChatGPT's virtualizer. For every observed turn:

1. the turn ID is recorded in a persistent `seenTurnIds` set;
2. if that turn has never been retained, `captureTurn(id)` runs immediately in the mutation callback;
3. one short deferred capture runs after 120 ms to catch ordinary post-insertion hydration;
4. repeated/remounted copies remain safe because the existing richness-aware retention logic only replaces a retained turn with a richer candidate.

The observer also handles a wrapper element that contains one or more newly inserted turn sections and a section whose `data-testid` is assigned after insertion.

This does **not** reintroduce global DOM waiting. It captures only the turn that actually mounted.

## Completeness diagnostics

The page crawler now reports:

- `seenMountedTurns`
- `seenMountedUnretainedTurns`
- `seenMountedUnretainedTurnIds`
- `mountObserverImmediateCaptures`
- `mountObserverSettledCaptures`
- `mountObserverEvents`
- `mountObserverFlushCaptures`

The important invariant is `seenMountedUnretainedTurns === 0`: every turn ID that the crawler actually observed in ChatGPT's DOM has a retained candidate.

Before automatic capture is handed to manual diagnostics/finalization, beta9 waits for the tiny pending mount-settle window, captures the still-mounted range once more, and returns the final mount-retention summary.

The crawler deliberately does **not** infer that numerical turn IDs must be contiguous. The invariant is based on observed DOM evidence, so branch/UI behavior cannot create a false missing-turn warning merely because an ID never appeared.

## Disclosure fidelity and performance

beta9 does not change beta8's turn-scoped disclosure convergence, successful-disclosure retry reset, three main traversals, oldest-edge verification, or retained-disclosure reconciliation limits.

In particular, beta9 does not restore the whole-mounted-DOM quiescence requirement that caused dev2.4's multi-minute `1/3 quiet rounds` stalls.

## MHTML diagnostics

The MHTML development instrumentation is intentionally unchanged in beta9.

The dense material-DOM snapshots were what proved both:

- the dev2.4 stall was unrelated virtualizer churn rather than disclosure hydration; and
- the beta8 missing turns really did mount in the live ChatGPT page between crawler checkpoints.

Until the new mount-retention invariant has been validated on a real run, preserving that diagnostic resolution is more useful than reducing the ZIP size.

## Regression test

`tests/mount-retention-smoke.mjs` reproduces the beta8 race directly:

- turn 15 mounts between formal traversal captures and must be retained immediately;
- turn 47 is inserted inside a wrapper and must also be retained;
- deferred richness capture must run without adding another synchronous clone on an already-retained remount;
- after a flush, the observed-but-unretained count must be zero.

The existing beta8 turn-scoped quiescence and endpoint-churn tests remain unchanged.
