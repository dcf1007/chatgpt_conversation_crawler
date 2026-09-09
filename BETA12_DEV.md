# v1.6.7-beta12-dev

This is a development diagnostic build for fidelity validation. It is not a clean release and must not be merged into clean `main` as a diagnostic package.

## Purpose

`beta12-dev` keeps the proven beta11 automatic crawler and the beta11-dev diagnostic wrapper, then adds the audited fidelity corrections discovered from the beta11 Authenticated/Anonymous MHTML analysis and the 2026-09-09 link/image fixture.

The automatic crawler remains the production core. MHTML capture and the two-step manual comparison remain development-only instrumentation around that core.

## Included accepted improvements

- beta8 turn-scoped disclosure convergence and retry reset.
- beta9 mount retention and the beta11 synchronous remount/descendant-hydration recapture model.
- beta11 media-aware retained-turn richness, transient marker/app/image retention, canonical external `id`, stable stages/progress limits, and clean runtime boundaries.
- beta11-dev MHTML recorder, idle capture safety net, start gate, and dynamic two-step manual validation.
- the Check-session UI lifecycle fix: fresh `/api/session/status` polling while login/session verification is active, an in-flight guard, and automatic button re-enable after the backend releases the profile.
- uploaded-image sanitizer fix: media descendants of interactive message controls are unwrapped and preserved instead of deleting the whole button subtree.
- accurate main-image finalization accounting: only image records referenced by the final sanitized HTML count as archive images/embedded bytes; retained-but-unreferenced source images are reported separately.
- Run-code UI labels remain excluded from archival conversation content while meaningful media descendants are retained.

## Evidence behind the media correction

The beta11 authenticated MHTML audit showed that uploaded images are ordinary `<img>` descendants inside message buttons such as:

```html
<button aria-label="Open image: Uploaded image">
  <img alt="Uploaded image" src="https://...oaiusercontent.com/files/...">
</button>
```

The previous snapshot sanitizer removed the button when it had no text, which also removed the image. The resource subsystem could therefore report retained image bytes even though the final turn no longer referenced them.

The 2026-09-09 independent link/image fixture reproduced the same defect with a 1176×835 uploaded screenshot in `conversation-turn-19`. The beta11-dev automatic and post-manual static snapshots contained 32/32 turns and reported 3/3 main-chat images embedded, but turn 19 contained no image element. The MHTML contains the image inside the message button, confirming that the loss occurs during static sanitization rather than network/resource capture.

`beta12-dev` preserves that image subtree and also makes final image statistics reference-aware so the same class of failure cannot present as a false 3/3 or 8/8 success.

## Link behavior observed in the fixture

Normal `<a href>` elements exposed by ChatGPT are preserved by the snapshot sanitizer, with `target="_blank"` and `rel="noopener noreferrer"` added to the static archive.

Some ChatGPT artifact/download actions are not serialized as links at all. In the MHTML they appear as React behavior buttons with visible text but no `href`, URL, or serializable target metadata, for example a button labelled `Download the corrected ...zip`. A script-free archive cannot reconstruct a target that the page does not expose in the serialized DOM. `beta12-dev` therefore preserves the visible label as static content and does not fabricate a URL.

Literal URLs that ChatGPT exposes only as plain text likewise remain plain text; the crawler does not invent hyperlink semantics that are absent from the source DOM.

## Sanitizer audit status

The completed beta11 MHTML removed-content audit covered 721 Authenticated and 258 Anonymous snapshots. Its semantic pass found:

- 191 hidden-text shapes in each mode, all inside math rendering/accessibility layers already extracted before hidden-node removal;
- no non-math hidden text examples;
- no dialog/menu/menuitem text examples;
- no turn-level canvas, form, input, textarea, or select content;
- authenticated visible SVGs only in UI buttons;
- authenticated iframes only in the app-block path handled by the dedicated app capture pipeline.

This is the current evidence boundary. `beta12-dev` exists specifically so a second, deliberately rich-content conversation can challenge these assumptions with different content classes.

## Diagnostic outputs

Each run writes MHTML diagnostics under:

`mhtml-diagnostics/<run>/`

Authenticated runs also write the two-step manual comparison under:

`manual-inspection-diagnostics/<run>/`

The manual comparison dynamically selects rich turns from the automatic corpus; it does not hard-code conversation turn numbers. It saves the automatic baseline, per-target before/after snapshots and metrics, and the post-manual snapshot.

## Running

Windows:

```text
setup-windows.bat
start-windows.bat
```

Linux:

```text
./setup-linux.sh
./start-linux.sh
```

macOS:

```text
./setup-macos.sh
./start-macos.sh
```

The launchers intentionally start `server-dev.mjs` in this diagnostic package.

## What to upload for the rich-content fixture

For the Authenticated run, preserve:

1. final downloaded static HTML;
2. the complete `mhtml-diagnostics/<run>/` directory, zipped (including all split ZIP parts when present);
3. the complete `manual-inspection-diagnostics/<run>/` directory, zipped.

If an Anonymous comparison is useful for that conversation, preserve the Anonymous final static HTML and Anonymous MHTML directory as well.

Do not upload `browser-profile/`.

## Validation target for beta12

The next audit should inventory every content class actually exposed by the rich-content chat and trace it through live DOM/MHTML → retained turn → sanitizer/specialized capture → final static HTML. In particular check normal links, citations, images, uploaded images/files, SVG, formulas/MathML, code/pre, tables, blockquotes, collapsible reasoning/tool UI, app blocks/iframes, timeline markers, and any new widget/card/attachment structures not represented in the earlier fixtures.
