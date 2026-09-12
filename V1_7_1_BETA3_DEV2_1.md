# v1.7.1-beta3-dev2.1

This is a diagnostic-only performance correction to `v1.7.1-beta3-dev2`.
Permanent crawler semantics are unchanged.

## What changed

- Removed the one-second diagnostic sampling loop.
- Added event-driven diagnostic wakeups from crawler progress, relevant chat DOM mutations, visibility/focus changes, and the existing lazy-resource events.
- Any diagnostic event postpones the 10-second inactivity safety snapshot, even when the event does not result in an MHTML capture.
- Split diagnostic sampling into a lightweight event-detection sample and a rich forensic sample. Rich revision maps, logical disclosure keys and per-turn disclosure details are collected only for actual MHTML captures/finalization.
- Limited deep `turnDisclosureSample()` calls to mounted turns that currently contain a closed disclosure candidate instead of every mounted turn.
- Removed full MHTML SHA-256 calculation. MHTML serialization and file writing remain; manifest rows retain filename, byte length, timings, coalescing provenance, semantic hashes/deltas and anomaly indexes.
- Switched diagnostic text-length sampling from `innerText` to `textContent` to avoid forcing layout on large virtualized pages.

## Preserved from beta3-dev2

- Enriched `manifest.jsonl` schema and hash/delta compaction.
- `summary.json` run index and interesting sequence list.
- Exact semantic revision/conflict/failure/timeout transitions.
- Mounted/retained topology hashes and changed sets.
- MHTML request coalescing and 10-second idle safety captures.
- Existing beta3 crawler, navigation, disclosure, hydration, retention and archive behavior.

## Scope

This does not advance the beta4 plan. Beta4 remains reserved for the previously agreed evidence-driven hydration classifier work, disclosure-key stability, app/canvas fidelity, finalization ordering, semantic progress UI/signatures, release mutability, retirement of legacy `remaining`, generation-history bounds, and the real 60/60-zoom/120 regression audit.
