# v1.7.1-beta4-dev2

This development prerelease is a diagnostic/lifecycle correction on top of `v1.7.1-beta4-dev`.

## Scope boundary

The validated beta4 crawler/fidelity implementation is intentionally frozen. This release does **not** change automatic traversal, turn targeting, disclosure expansion, hydration reconciliation, retained-turn selection, foreground protection, image/app capture semantics, archive sanitization, or final archive content construction.

The change is confined to development diagnostics and the server lifecycle that publishes completion.

## Why this release exists

A supplied authenticated beta4 diagnostic run retained all 66 observed turns and finished with zero turn-processing failures and zero unresolved retained disclosures, while the diagnostic recorder wrote 1,992 MHTML snapshots totaling approximately 6.70 GB. Of those snapshots, 1,823 were named `material-dom-change`; only 198 of those rows reported a retained-semantic signature change.

That evidence confirms the previously identified architecture error: high-frequency diagnostic state was still controlling full-document MHTML serialization. MHTML is expensive enough to perturb crawler timing, so physical virtualizer/DOM activity must remain telemetry rather than a snapshot trigger.

## Diagnostic architecture

Beta4-dev2 separates the two streams:

```text
high-frequency diagnostic events
        |
        +--> lightweight JSONL telemetry

explicit semantic/forensic checkpoints
        |
        +--> bounded Chromium MHTML snapshot
```

`material-dom-change` and `lazy-resource-loaded` are telemetry-only reasons. They cannot directly enter the MHTML queue.

The MHTML checkpoint policy deliberately excludes physical-only state such as scroll position, scroll height, viewport size, mounted first/last turn, arbitrary virtualizer mount/unmount churn, ordinary React DOM changes, and progress-step movement.

Full MHTML remains available for forensic boundaries such as:

- initial loaded state;
- final/context-closing state;
- ten seconds of genuine inactivity;
- manual diagnostic interaction;
- turn-processing failure/recovery state changes;
- new hydration timeout state;
- hydration-conflict state changes;
- target-turn disclosure state changes;
- selectively, resource state that advances retained archive semantics.

The frequent event path stays lightweight. Rich crawler maps/disclosure details are collected when a full MHTML checkpoint is actually taken, rather than before every raw material-DOM event.

## Bounded MHTML capture

`Page.captureSnapshot` now has a 60-second hard timeout. A timed-out or stale diagnostic CDP session is detached and recreated for later checkpoints. Recoverable stale-session failures are retried once on a fresh session; a timeout itself is recorded and not immediately retried, so one Chromium serialization cannot block shutdown indefinitely.

Manifest timing is now explicit:

- `requestedAt` — request entered the MHTML queue;
- `captureStartedAt` — Chromium serialization attempt began;
- `captureCompletedAt` / `capturedAt` — capture attempt finished;
- `queueLatencyMs`;
- `captureDurationMs`;
- `captureLatencyMs` — total request-to-finish latency;
- `captureAttempts`;
- `captureTimedOut`;
- `cdpRecovered`.

Telemetry records carry `entryType: "telemetry"`; MHTML records carry `entryType: "mhtml"`. The summary separately counts manifest records, telemetry records, snapshots, timeouts, recovered CDP sessions, bytes, and per-reason activity.

## Shutdown and completion truthfulness

Recorder shutdown seals event/resource callbacks before requesting the closing checkpoint, so late diagnostic activity cannot keep extending the queue during teardown.

The archive server no longer publishes `state: complete`, `stage: complete`, `finishedAt`, or download readiness immediately after final HTML assembly. It remains in `finalization` / `Closing browser session` while the authenticated handle or anonymous context/browser closes. The final complete state is published only after those resources and the diagnostic recorder have finished cleanup.

## Regression gates added

The release adds focused tests that prove:

- physical viewport/topology changes do not alter the MHTML checkpoint signature;
- 1,000 `material-dom-change` events create 1,000 JSONL telemetry records and zero MHTML files;
- semantic failure/hydration/target-disclosure transitions still select forensic checkpoints;
- raw material/resource events cannot directly call `captureRich()`;
- shutdown seals the hook before the final recorder capture;
- a hanging `Page.captureSnapshot` is bounded and the CDP session recovers for the next checkpoint;
- MHTML summary/timing metadata remains truthful;
- server completion is published only after browser/session references have been released;
- the existing ten-second inactivity scheduler and one-active/one-pending MHTML coalescing behavior remain covered by their existing tests.

## Version

Package version: `1.7.1-beta4-dev2`
