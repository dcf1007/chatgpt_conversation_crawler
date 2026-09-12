# v1.7.1-beta3-dev2

This development diagnostic prerelease is deliberately narrow. It retains the complete validated `v1.7.1-beta3-dev` crawler behavior and enriches only the development MHTML diagnostic index so future regression audits can begin from `summary.json` + `manifest.jsonl` and request individual MHTML snapshots only when exact DOM evidence is required.

## No crawler behavior changes

The following beta3 crawler contracts are unchanged:

- semantic-evidence revisions remain independent from disclosure presentation state;
- passive forward/reverse discovery and post-processing verification remain capture-only;
- guarded turn-local coverage and targeted semantic revalidation are unchanged;
- logical disclosure completion remains revision-scoped;
- exact endpoint `setTop()` and assisted `navigateTop()` remain separate;
- hydration classification, canonical/evidence union behavior, archive integrity, snapshot fidelity, and transient-content handling are unchanged.

## Enriched `manifest.jsonl`

Each recorded MHTML now carries stronger audit metadata while preserving append-only JSONL:

- crawler package version and best-effort source commit;
- SHA-256 of the exact MHTML body;
- request id, capture latency, elapsed time since the prior snapshot;
- coalesced/suppressed pending request count and recent reasons;
- retained semantic revision and retained-corpus fingerprint;
- stable hashes for mounted IDs, retained IDs, the per-turn revision map, disclosure state, actionable logical keys, hydration-conflict IDs, processing-failure IDs, timeout IDs, and unresolved IDs;
- precise per-snapshot deltas such as changed revisions, newly retained turns, new/resolved hydration conflicts, new processing failures/timeouts, and new/resolved unresolved turns;
- full mounted/retained/control sets only on the first row or when those sets change, avoiding repetition on every line;
- exact mounted disclosure metadata grouped by turn when disclosure state changes;
- mount-retention, oldest-edge, reconciliation, semantic/physical endpoint, active-turn, progress, manual-inspection, foreground, focus, and navigation telemetry.

The manifest compactor compares against the preceding **actually recorded** snapshot, so coalesced requests do not create false deltas against a state that never reached disk.

## New `summary.json`

Every diagnostic folder now receives a compact `summary.json` when its recorder closes. It contains:

- diagnostic id, URL, session mode, crawler version, source commit, start/end times;
- snapshot/request/coalescing counts and total MHTML bytes;
- first/last/max semantic retained revision and maximum retained turn count;
- viewport/scroll geometry extrema and maximum navigation amplification;
- the union of retained turn IDs, hydration-conflict IDs, failed-turn IDs, and hydration-timeout IDs;
- unresolved turn IDs at the end of the run;
- contiguous phase ranges mapped to manifest sequence ranges;
- automatically selected interesting sequence numbers for semantic changes, phase transitions, conflicts, failures, unresolved-state changes, manual interaction, coalescing, and amplification;
- a compact final convergence/integrity-related state snapshot.

This summary is an index, not a substitute for MHTML ground truth.

## Audit workflow

For future beta4 regression reviews, the intended first upload is:

1. `summary.json`
2. `manifest.jsonl`

The exact MHTML sequence numbers needed for forensic inspection can then be requested after the full run has been indexed. All MHTML files are still retained locally.

## Scope

This version remains a development diagnostic prerelease. `main` is not promoted or modified. The previously agreed beta4 work remains reserved for beta4 and is not implemented here.
