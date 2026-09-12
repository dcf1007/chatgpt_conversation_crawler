# ChatGPT Conversation Crawler v1.7.1-beta4-dev

Beta4 keeps the validated beta3 semantic navigation/coverage architecture and adds a bounded final recovery layer for turns that remain failed or logically unresolved after global remount verification.

## Behavioral corrections

- Current turn-processing failures receive a fresh post-remount recovery epoch before finalization.
- Recovery resets only transient physical disclosure attempts for the target turn; retained semantic evidence and valid logical completion proofs remain authoritative.
- If recovery adds semantic evidence, the repaired corpus receives one opposite-direction passive closure challenge before final certification.
- Historical failed attempts are retained diagnostically while a later successful retry clears the current failure state.
- Passive app/image/timeline retention is drained and sealed before the final convergence decision; later server flushes are no-ops.
- App-preview mutations coalesce into a trailing capture after the existing app-block throttle window rather than periodic polling.
- Ordinary conversation-turn canvases are preserved as static PNG images in retained archive HTML where serialization succeeds, with a bounded text fallback otherwise.

## Evidence-first diagnostics

- Active hydration conflicts now record bounded fact-difference diagnostics by semantic fact kind and context when a conflict materially changes.
- The hydration classifier itself is intentionally unchanged until the new 60/120-turn evidence identifies a mechanically false-positive fact class.
- Observed-generation history is measured (`observedGenerationTotal`, `observedGenerationMaxPerTurn`) but not capped without real-run distribution evidence.
- Logical disclosure identity is regression-tested against volatile `aria-controls` changes and repeated same-label siblings; no speculative key redesign is included.

## Preserved beta3 invariants

- semantic evidence revisions are independent of collapsed/open presentation state;
- exact endpoints use non-adaptive `setTop()`;
- turn navigation remains identity/current-geometry based;
- passive discovery/verification does not click disclosures;
- revision-scoped logical disclosure completion suppresses same-revision collapsed remounts;
- no `Page.bringToFront()`, native focus hacks, historical scroll-position authority, or global click-everything sweep is introduced;
- beta3-dev2.1 event-driven diagnostic recording remains unchanged.

## Validation target

The release is not considered ready until the full Chromium-backed test suite passes and the known 60-turn normal/large-viewport plus 120-turn real regression matrix is audited. In particular, the automatic 60-turn archive must no longer gain semantic content merely because the later manual diagnostic invokes the same production turn processor.
