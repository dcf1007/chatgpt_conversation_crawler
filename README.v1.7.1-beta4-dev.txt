ChatGPT Conversation Crawler v1.7.1-beta4-dev

Beta4 is a correctness/fidelity development release built on beta3-dev2.1.

Primary changes:
- bounded post-remount recovery for current failed/unresolved turns before finalization;
- opposite-direction closure verification after a semantic repair;
- historical failure telemetry separate from current failure state;
- passive transient-retention sealing before final convergence;
- trailing coalesced app-block capture without periodic polling;
- retained main-chat canvas serialization/fallback;
- hydration conflict fact-difference diagnostics without suppressing warnings;
- observed-generation measurements without an unproven history cap;
- mutable GitHub release handling in the normal workflow.

The beta3 semantic endpoint, identity-navigation, guarded turn coverage, revision-scoped disclosure completion, and beta3-dev2.1 event-driven diagnostic logger remain in place.

This is a development build. Keep it on dev until the known real 60/120-turn regression matrix passes.
