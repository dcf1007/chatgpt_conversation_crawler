ChatGPT Conversation Crawler v1.7.1-beta3-dev2.1

Diagnostic performance correction for beta3-dev2.

The enriched manifest.jsonl and summary.json remain intact, but the development
MHTML logger no longer deep-samples the page once per second. Diagnostics are
now event-driven (crawler progress, relevant DOM mutations, and lazy resources)
with the existing 10-second inactivity safety capture.

Rich per-turn revision/disclosure metadata is collected only when an MHTML is
actually going to be written. Deep disclosure inspection is limited to mounted
turns that contain closed disclosure candidates. Full MHTML SHA-256 hashing was
removed from the recorder hot path; manifest rows still record exact filename,
byte length, capture timing, semantic hashes/deltas, and anomaly indexes.

Crawler/navigation/disclosure/hydration/archive behavior is unchanged from
v1.7.1-beta3-dev2. Beta4 remains reserved for the previously agreed runtime and
fidelity work.
