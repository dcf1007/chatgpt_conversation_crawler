# v1.6.7-beta14-dev

Development-only follow-up to the beta13.1 giant-conversation diagnostic. This build is intended for another authenticated real-world run and must not be promoted to `main` until its MHTML/manual-inspection evidence is reviewed.

## Evidence from beta13.1

The beta13.1 run changed the failure shape substantially: the automatic crawler terminated at 120 retained turns and 479 confirmed expansions instead of reproducing beta12's unbounded turn-62/turn-64 expansion cycle. However, the diagnostic sequence exposed three remaining problems:

- long automatic stalls still occurred, and the user observed that bringing the Chromium window into focus caused progress to resume;
- manual remounting of the second target (`conversation-turn-14`) spent 189 navigation/probe steps oscillating among early mounted windows until a much larger manual scroll displacement moved the virtualizer into a useful range;
- manual expansion of turns 6 and 14 produced richer retained generations after beta13.1 had already treated their logical disclosures as complete, proving that successful activation plus retained progress is not yet a semantic fixed point.

## What beta14-dev changes

### Foreground-equivalent capture scheduling

The existing Chromium launch flags remain in force (`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`, and `--disable-renderer-backgrounding`). Beta14-dev additionally installs Chromium CDP focus emulation (`Emulation.setFocusEmulationEnabled`) on the actual capture page before automatic traversal. This does not bring the OS window to the foreground or steal focus; it removes the crawler's dependence on a real window-focus event where Chromium honors that emulation.

MHTML manifest entries now record `document.visibilityState`, `document.hidden`, `document.hasFocus()`, whether focus emulation was installed, live scroll coordinates, and manual-scroll-assist state. A beta14 diagnostic can therefore correlate any future stall directly with page visibility/focus state instead of inferring it from user intervention.

### Disclosure fixed-point verification

Beta13.1 marked a logical disclosure complete immediately after any confirmed activation. Beta14-dev changes that rule:

- if a confirmed activation produces a richer retained generation of the same turn, the disclosure remains eligible at the new turn revision;
- the crawler may therefore verify the remounted disclosure once more;
- only a confirmed activation that produces no newer retained generation records completion at the current turn revision;
- once that no-progress verification occurs, same-revision virtualizer remounts are suppressed exactly as in beta13.1.

This preserves beta13.1's bounded per-turn/per-disclosure convergence while addressing the real turn-6/turn-14 fidelity loss.

### Manual virtualizer navigation

The independent two-step manual comparison still uses the existing target-selection and remount logic. During that diagnostic phase only, beta14-dev wraps `crawler.setTop()` with a logical-progress assist. Normal requested scrolls are unchanged while the mounted turn window advances. If repeated scroll requests fail to advance the mounted conversation-turn edge, the displacement is progressively amplified (and clamped to the real scroll range) so the virtualizer is forced out of a small oscillating window instead of spending hundreds of tiny coordinate moves there.

The assist is removed when manual diagnostics end and does not alter the automatic traversal policy.

## What to test

Run the same authenticated 120-turn conversation used for beta12/beta13/beta13.1. It is particularly useful to leave the Chromium window unfocused or covered for part of the automatic crawl rather than manually rescuing it immediately. If it appears stalled, allow enough time for several MHTML captures before focusing the window so the new manifest fields can show whether focus/visibility state correlates with the stall.

For the manual comparison, let the crawler locate both targets on its own if possible. Do not make the large turn-14 rescue scroll unless it is clearly stuck again; if intervention becomes necessary, note roughly when it happened and preserve the complete MHTML diagnostics and `two-step-manual-inspection` ZIP.

## Release boundary

This remains a diagnostic development prerelease. Do not publish a clean release from these changes until the new giant-conversation result is reviewed for both liveness and retained fidelity.
