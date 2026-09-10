# v1.6.7-beta14.3-dev

This development build corrects two regressions demonstrated by the beta14.2 authenticated MHTML acquisition telemetry while preserving the capture-fidelity work from beta14, beta14.1, and beta14.2.

## Navigation contract

The permanent crawler core now has two deliberately separate positioning operations:

- `crawler.setTop(value)` is exact positioning. Pass initialization, endpoint pinning, and oldest-edge verification use it without adaptive amplification or hidden navigation state.
- `crawler.navigateTop(value)` is assisted traversal. Automatic traversal and diagnostic remount sweeps use it when moving incrementally through ChatGPT's virtualized conversation.

Assisted navigation still measures progress from the leading edge of the active virtualized viewport. Movement of a tall leading turn through the viewport counts as progress, and reversing direction starts a new baseline. Repeated genuine stagnation can still amplify displacement, but that state is reset at traversal/remount phase boundaries and cannot alter exact endpoint probes.

This separation addresses the beta14.2 zoom-sensitive failure where a 1000 CSS-pixel viewport stalled near a large final turn, zooming out changed the client height to 4000 and released the traversal, and the 25% zoom oldest-edge verifier then oscillated between the top and a 1520px nudge. The diagnostic evidence showed that exact positioning and adaptive recovery had been sharing one global `setTop` wrapper.

## Background activity without native window activation

The crawler retains its permanent background protections:

- Chromium launch flags disabling renderer, timer, and occluded-window background throttling.
- `Emulation.setFocusEmulationEnabled`.
- `Emulation.setIdleOverride`.
- `Page.setWebLifecycleState` with the active lifecycle state.

`Page.bringToFront` is no longer used. Reasserting crawler activity must not restore, raise, maximize, or otherwise activate the native browser window. This directly addresses the beta14.2 diagnostic loops where foreground reassertions climbed repeatedly while traversal remained logically stuck.

## Diagnostic wrapper

MHTML acquisition remains diagnostic-only. Its telemetry is retained because it exposed the failure sequence, but the navigation and activity corrections are in the permanent crawler core. The headed authenticated manual validation phase uses the same `crawler.navigateTop()` implementation as automatic traversal rather than carrying a separate scrolling algorithm.

## Regression coverage

The smoke suite checks that:

- exact `setTop()` remains exact even after assisted stagnation;
- assisted navigation still recognizes active leading-edge and tall-turn progress;
- a CSS-pixel client-height change from 1000 to 4000 does not contaminate endpoint positioning;
- the 1520px large-client oldest-edge nudge remains an exact coordinate;
- foreground installation and reassertion never send `Page.bringToFront`.

The build remains a `dev` prerelease and is not a promotion to `main`.
