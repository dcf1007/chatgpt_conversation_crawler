# v1.7.1-beta2-dev

This development diagnostic prerelease retains the complete `v1.7.1-beta-dev` crawler implementation and corrects one diagnostic-truthfulness defect discovered by rechecking the completed `v1.7.0-beta3-dev` MHTML recorder batches. It does not add a new crawler capability or change automatic archive behavior.

## Correction in beta2

During `v1.7.0-beta3-dev` manual-target remounting, the MHTML recorder sampled `window.__archiveManualInspection.targetTurnId`. That state was created only after a target had successfully remounted and the manual overlay was installed. As a result:

- the first diagnostic remount could report an empty `manualTargetTurnId` throughout remounting;
- the second diagnostic remount could continue reporting the completed first target while the crawler was actually navigating to the second target.

`v1.7.1-beta2-dev` publishes a lightweight, non-interactive manual-remount diagnostic state before shared logical turn navigation begins. The state contains:

- `phase: remounting-target`;
- the upcoming manual step index/count;
- `stepLabel: Remounting diagnostic target`;
- the upcoming `targetTurnId`;
- the upcoming target reason;
- zero manual interactions and `finishRequested: false`.

Any previous manual observer/listener and stale overlay/highlight state are cleaned before this remount state is installed. When the target is mounted, the existing interactive manual-inspection state replaces it normally.

This makes the recorder's existing `manualTargetTurnId`, manual-step, and manual-phase fields describe the target currently being remounted instead of the previous manual step.

## Regression coverage

`tests/manual-inspection-smoke.mjs` now includes the exact stale-target regression shape from the 120-turn beta3 evidence: after a previous manual target such as `conversation-turn-6`, the descriptor for manual step 2 must immediately identify `conversation-turn-14`, remain non-interactive during remounting, and begin with zero manual interactions.

The existing sparse-virtualizer/logical-remount assertions remain unchanged.

## Unchanged from v1.7.1-beta-dev

All crawler corrections introduced in `v1.7.1-beta-dev` remain unchanged, including:

- capture-only discovery followed by retained-turn-first processing;
- logical retained-turn navigation with no persistent historical page-pixel anchors;
- current-geometry positioning of mounted logical anchors;
- whole-turn viewport coverage, including interior bands for unusually tall turns;
- turn-scoped disclosure expansion and post-expansion re-coverage;
- one reverse and one forward semantic verification sweep;
- targeted retained-disclosure reconciliation;
- separation of canonical real observed hydration generations, accumulated semantic evidence, and synthetic preservation unions;
- centralized turn-convergence/integrity reporting;
- detached integrity evaluation for development diagnostic snapshots;
- no `Page.bringToFront()` or native window-activation recovery;
- exact `setTop()` versus assisted `navigateTop()` semantics.

The production disclosure recognizer is still not special-cased for the recurring `conversation-turn-37` symptom. The next two live regression runs remain the evidence source for determining whether targeted processing resolves it or exposes a generic classifier defect.

## Scope

This version is still a development diagnostic prerelease. The diagnostic wrapper remains intentionally absent from clean `main`, and `main` is not promoted or modified by this beta2 release.
