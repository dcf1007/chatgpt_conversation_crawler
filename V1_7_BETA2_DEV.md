# v1.7.0-beta2-dev

This development release builds on beta1 with narrowly scoped robustness fixes for existing crawler behavior.

- Chromium activity protection recreates a stale CDP session once when all non-window-activating overrides fail. Page.bringToFront remains forbidden.
- Main-image finalization accounts retained bytes by unique content digest rather than charging duplicate URLs repeatedly.
- App-block capture replaces an older generation when equal-richness metrics hide changed serialized content.
- The permanent crawler is installed before transient-context observation begins, closing the crawler-less timeline-marker window.
- All beta1 archive-integrity and hydration-reconciliation behavior remains unchanged.
