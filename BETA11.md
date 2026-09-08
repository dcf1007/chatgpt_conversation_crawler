# v1.6.7-beta11 — regression hardening

beta11 is the corrective release after the beta8–beta10 cleanup audit. It keeps the automatic crawler decisions that were validated in beta8/beta9—turn-scoped disclosure convergence, three principal traversals, oldest-edge verification, bounded retained-disclosure reconciliation, and capture-on-mount—while fixing cross-module and retention gaps exposed by the clean-release review.

## Canonical archive identifier

The local API and both browser pages now use **`id`** as the only archive identifier name:

- `POST /api/archive/start` returns `{ "id": "..." }`;
- the main UI stores `data.id`;
- live preview opens as `preview.html?id=...`;
- preview reads only `params.get('id')`;
- status, preview, download and cancel routes remain `/:id`.

The beta10.2 `job`/`id` compatibility fallback is intentionally removed. Tests fail if `jobId`, `?job`, or `params.get('job')` reappears.

## Rich remount and hydration retention

beta9 guaranteed that every observed turn ID had some retained copy. beta11 strengthens that invariant at the generation boundary:

- every mounted/remounted turn section is synchronously `captureTurn()`-ed even if the ID was retained before;
- child-list hydration inside an already-mounted turn synchronously re-captures the owning turn;
- each affected turn is de-duplicated within a MutationObserver batch;
- the existing 120 ms debounced settle capture remains as a second richness pass;
- if a richer remount disappears before that delayed pass, the synchronous generation is already retained.

This remains turn-local. It does **not** restore whole-viewport stabilization or whole-mounted-DOM quiescence.

## Richness ordering

Retained-turn replacement now accounts for user-visible non-text structure. Priority is:

1. `<pre>` count;
2. `<code>` count;
3. media (`img`, `svg`, `canvas`, `video`) count;
4. app-block root count;
5. fewer remaining recognized disclosures;
6. HTML size;
7. text size;
8. element count.

This prevents an older, slightly text-heavier copy from defeating a later generation that exposes uploaded images or app content.

## Transient context outside turn clones

A separate event-driven retention path protects content that turn cloning alone cannot preserve:

- timestamp/date separators and `Branched from` markers are captured synchronously when their DOM appears or changes;
- app-preview mutations immediately trigger Node-side app-block frame capture;
- transient image/blob DOM immediately triggers the existing image-retention path.

Finalization still performs explicit image/app flushes.

## Stable stage contract

Crawler progress now emits a machine-readable `stage` enum instead of asking the frontend to infer semantics from English `phase` strings:

- `queued`
- `loading`
- `preparing`
- `traversal`
- `oldest_verification`
- `reconciliation`
- `finalization`
- `complete`
- `error`
- `cancelled`

The server also exposes crawler progress limits from the crawler module itself. The UI no longer hard-codes the oldest-edge or reconciliation limits and no longer regex-parses phase text.

## Clean runtime boundary

Automatic disclosure/quiescence authority is renamed from the misleading development terminology:

- `crawler-page-diagnostics.mjs` is removed;
- `installBeta8Diagnostics()` is removed;
- `crawler-disclosure-state.mjs` / `installDisclosureState()` now own the required automatic state.

The clean server/UI no longer expose `diagnosticStep`, `diagnosticSteps`, `waitingForUser`, “Diagnostic validation”, or “Waiting for you”. Development-only MHTML/manual-inspection runtime remains absent from beta11.

## Release gates

beta11 adds or strengthens regression coverage for:

- richer remounts that disappear before the settle timer;
- descendant hydration without a section remount;
- media-aware retained-turn replacement;
- canonical `id` across start/UI/preview/API;
- explicit stage and progress-limit contracts;
- absence of clean-build diagnostic state/naming;
- real local-server start → status → preview → download contract wiring;
- clean launcher entrypoints.

The release workflow now installs Node dependencies before running the runtime suite, which allows the production server integration test to run rather than relying solely on source-string checks.
