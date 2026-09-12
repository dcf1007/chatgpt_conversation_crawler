ChatGPT Conversation Crawler v1.7.1-beta3-dev2

Development diagnostic prerelease.

This build is crawler-behavior-identical to the validated v1.7.1-beta3-dev implementation. The only functional change is development diagnostic indexing: manifest.jsonl now contains semantic hashes/deltas, exact MHTML SHA-256 values, coalescing provenance, richer disclosure/retention/convergence metadata, and changed full sets when needed. Each MHTML diagnostic folder also receives summary.json at recorder close.

For regression review, upload summary.json and manifest.jsonl first. Individual MHTML snapshots can then be requested by exact sequence number only where DOM-level evidence is needed. The recorder continues to preserve every MHTML locally.

No beta4 crawler, hydration-classifier, app/canvas fidelity, UI-phase, transient-finalization, or release-mutability work is included in this build. main remains untouched.
