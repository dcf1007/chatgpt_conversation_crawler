# v1.7.0-beta1-dev

This development release hardens archive integrity without changing the established exact/assisted navigation contract.

- Normal and manual-diagnostic snapshot construction share one detached-state contract and never rewrite live retained crawler state.
- Turn hydration is content-aware. Clearly richer/superset generations replace older copies; incomparable generations retain the multiset union of non-duplicated content.
- Duplicate occurrences within one real generation remain duplicated.
- Hydration conflicts are counted and only resolved when a later single generation covers the retained union. Unresolved conflicts remain in the archive and are reported as integrity warnings with affected turn IDs.
- Semantic turn revisions advance for novel content generations rather than only for the generation selected as the archival winner. A known poorer collapsed remount does not advance the revision again.
- Retained-corpus and retained-disclosure convergence fingerprints include those semantic turn revisions, so equal-size/equal-count content changes cannot be mistaken for a stable corpus.
- Mount retention observes character-data hydration in addition to child/attribute changes.
- Traversal, expansion and hydration/quiescence safety limits are durable results rather than silent exits; hydration timeout warnings retain the affected turn IDs when available.
- Final integrity validation reports missing retained turns, non-converged scans, unresolved disclosures, expansion limits, hydration timeouts, and unresolved hydration conflicts.
- A crawl with unresolved integrity conditions finishes as Complete with integrity warnings instead of claiming verified completion.
