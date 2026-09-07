# beta7-dev2 manual inspection diagnostic

`v1.6.7-beta7-dev2` keeps the beta7 fixed-point crawler and the beta6/beta7 MHTML recorder, then adds one development-only human inspection pass for the authenticated headed Chromium browser.

## Flow

1. The automatic beta7 crawler completes all three traversals and nested disclosure fixed-point checks.
2. The development build saves `automatic-before-manual.html`.
3. It selects one diagnostic turn. A turn with retained collapsed controls is preferred; otherwise the richest assistant/tool turn is selected.
4. The headed Chromium window is scrolled to that turn and the turn is highlighted with an amber outline.
5. Expand that highlighted turn completely, including every nested disclosure, and wait for each tool/code/result leaf to load.
6. Click **Finish manual inspection** in the overlay inside the ChatGPT window.
7. The crawler retains the manually revealed DOM, reruns beta7 fixed-point expansion on that mounted range, and saves `post-manual.html` plus `summary.json`.
8. The ordinary final archive is then built from the post-manual retained state.

## Diagnostic files

Each authenticated development run creates a directory under:

`./manual-inspection-diagnostics/<timestamp>-<turn>/`

It contains:

- `automatic-before-manual.html` — crawler output before any manual action;
- `post-manual.html` — crawler output after manual actions and reconvergence;
- `summary.json` — selected target, before/after crawler metrics, before/after target richness, and a bounded event log of manual disclosure interactions.

The existing `./mhtml-diagnostics/` capture remains active throughout the manual pause. Its manifest also records manual-inspection phase/target/interaction metadata, so browser MHTML can be aligned with the manual event sequence.

Both diagnostic directories may contain private ChatGPT content and signed resource URLs. They are ignored by Git and must never be committed or shared unintentionally. `./browser-profile/` remains separate and should never be uploaded.

Anonymous mode remains headless and does not pause for manual inspection. This preserves the public-view crawling environment while still recording its MHTML.
