# ChatGPT Share Archiver

A small local web app that turns a public ChatGPT conversation share page into a readable static HTML snapshot.

## What it does

- Accepts only `https://chatgpt.com/share/...` URLs.
- Uses Playwright/Chromium, so JavaScript and lazy-loaded content can run normally.
- Scrolls until the page height stabilizes.
- Opens native `<details>` elements and clicks visible disclosure controls whose labels look like “show more”, “thought”, “worked for”, or “reasoning”.
- Preserves semantic content such as headings, paragraphs, lists, tables, links, images, `<pre>`, and `<code>`.
- Removes scripts, iframes, hidden elements, and interactive app behavior from the exported file.

## Important boundary

The archiver captures only content that the shared page exposes to an ordinary browser after user-visible expansion. It does **not** inspect private application state, hidden network payloads, model internals, or private/hidden chain-of-thought. If a reasoning section is not actually exposed by the share page, it cannot and should not be recovered.

## Run locally

Requires Node.js 20+.

```bash
npm install
npx playwright install chromium
npm start
```

Then open:

```text
http://localhost:3000
```

Paste a ChatGPT share URL and choose **Create static HTML**.

## Notes

- Personal-account share links are typically public to anyone who has the link. Workspace links can be restricted to workspace members; this app intentionally does not import your ChatGPT login session.
- The exported HTML is static and script-free, but externally hosted images remain linked to their resolved public URLs rather than embedded as data URLs.
- ChatGPT's frontend can change. The expansion heuristic is intentionally conservative and may need selector/label updates in the future.
