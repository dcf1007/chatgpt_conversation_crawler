# v1.6.7-beta6 fidelity pass

This beta focuses on ordinary conversation fidelity while leaving authenticated-session handling, app-block flattening, formulas, main-image retention, and SVG handling otherwise unchanged.

## Disclosure hydration

A disclosure is no longer considered ready merely because `aria-expanded` changed. After a disclosure click, the crawler samples both the `aria-controls` target (when present) and the containing conversation turn. It waits for text length, retained HTML length, `<pre>`, `<code>`, media, and descendant counts to stabilize for three observations, with a bounded 3.6-second safety window.

Before moving away from a mounted range, the crawler also performs a bounded stabilization pass so asynchronously hydrated tool/code/result content has a chance to become part of the retained turn before virtualization removes it.

## Retained-turn authority

The previous scalar score gave a huge bonus to `remaining === 0`, which could allow a nominally expanded but not-yet-hydrated snapshot to outrank a richer earlier snapshot.

Beta6 uses a lexicographic content-richness vector instead:

1. more `<pre>` blocks;
2. more `<code>` elements;
3. more visible text;
4. larger retained HTML;
5. fewer remaining collapsed disclosures only as the final tie-breaker.

This makes actual retained content authoritative over the disclosure-state flag.

## Ordinary conversation typography

The static archive now applies a ChatGPT-like semantic typography layer to normal conversation content:

- 16px / 24px body text;
- 24px h1;
- 20px h2;
- 18px h3;
- 16px h4-h6;
- approximately 48rem desktop conversation width;
- smaller code/pre text consistent with the source UI hierarchy.

The rules are scoped to archived conversation content. App blocks retain their separately captured computed inline presentation.

## Removed source-UI artifacts

The archive already emits its own `User` / `Assistant` role labels. Source headings such as `You said:` and `ChatGPT said:` are screen-reader-only in ChatGPT but became visible after class stripping, so beta6 removes those duplicated headings from the static archive.

Collapsed-message UI remnants such as `Show moreShow less` are also removed after the full message has been retained.
