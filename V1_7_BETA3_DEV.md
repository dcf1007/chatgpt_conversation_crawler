# v1.7.0-beta3-dev

This development prerelease finishes the v1.7 diagnostic and maintenance batch without expanding the crawler's product scope.

## Diagnostic correctness

- MHTML manifest `phase`, `pass`, `direction`, `step`, and `stage` now follow the crawler's actual progress rather than static defaults.
- Diagnostic manifests distinguish `mountedTurns` from `retainedTurns`.
- Scroll position and viewport height participate in material-change sampling so a pure virtualizer bounce can be captured even when the DOM signature is otherwise unchanged.
- MHTML capture is bounded to one active `Page.captureSnapshot` plus the newest pending request. Intermediate pending requests are coalesced instead of building an unbounded serialization backlog.
- The obsolete manual-scroll-assist diagnostic telemetry is removed. Automatic traversal and manual remount diagnostics continue to use the permanent `crawler.navigateTop()` implementation.
- Manual target remounting preserves its best logical predecessor across virtualizer snap-back and uses bounded local probing once the target is bracketed.

## Cleanup and launcher parity

- The obsolete `src/manual-scroll-assist.mjs` implementation and its dedicated tests are removed.
- The PR diagnostic artifact uses the stable `dev-diagnostic-package` name instead of embedding a beta number.
- Current launcher wording no longer identifies the package with superseded development labels.
- Windows setup/start scripts enforce Node.js 20 or newer, and the Windows launcher honors `PORT` just like Linux and macOS.
- Verified dead server telemetry is removed.
- Oldest-edge remount probes remain exact and are capped at 520 CSS pixels so browser zoom cannot inflate a small verification nudge into a multi-turn jump.
- Non-converged reconciliation scans cannot count as stable passes, and final disclosure state is recomputed after the last mounted expansion sweep before integrity reporting.
- The UI explicitly distinguishes verified completion from `Complete with integrity warnings` and displays the durable warning messages.
- Maintained source and UI files are reformatted for readability without changing their crawler/UI contracts.

The diagnostic wrapper remains development-only and is still intended to be removed when the v1.7 line is promoted to the clean main release.
