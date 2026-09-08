# ChatGPT Conversation Crawler

A local Node.js + Playwright utility that turns a ChatGPT **shared conversation** into a readable, script-free static HTML archive.

It is designed for long conversations where a normal browser save can lose content because ChatGPT lazily loads history, virtualizes turns, mounts reasoning/tool/code sections on demand, and can render generated content inside nested app-preview iframes.

> **Boundary:** the crawler archives content that the selected browser mode exposes to the share page. It does not bypass account/workspace permissions or recover private model-internal chain-of-thought.

## Current architecture

The anonymous and authenticated modes use the **same automatic crawler and archive builder**. They differ only in browser/session setup and therefore in what ChatGPT may expose to that browser:

```text
Anonymous disposable browser ──────┐
                                   ├─> same automatic crawler ─> same archive builder
Authenticated persistent profile ──┘
```

A later v1.7 documentation update is planned after matching anonymous/authenticated diagnostic captures are compared. Until that comparison is performed, this README does not claim that specific upload names, image names, app blocks, or other resources are always available in one mode and unavailable in the other.

## Main features

- Accepts `https://chatgpt.com/share/...` URLs.
- Supports **Anonymous** disposable Chromium and **Authenticated** `./browser-profile` modes.
- Uses the same traversal, retention, disclosure, app-block, image, SVG, formula and finalization routines in both modes.
- Uses ChatGPT's actual internal conversation scroller rather than assuming the browser window scrolls.
- Progressively retains every observed virtualized `conversation-turn-*` section.
- A lightweight mount observer captures a newly mounted turn immediately and again after a short settling window, closing the race where a short turn can appear and disappear between formal traversal checkpoints.
- Replaces a retained turn only when a later version is richer, strongly preferring more `<pre>`, more `<code>`, more text, larger HTML, then fewer remaining recognized disclosures.
- Expands conversation-scoped **Worked for**, **Thought**, **Thinking**, **Reasoning**, structural `aria-controls` disclosures, and native `<details>`.
- Resets a disclosure's retry budget after a successful activation, so a later remount is eligible again.
- Uses **turn-scoped disclosure convergence**: unrelated virtualizer mount/unmount churn cannot reset the active turn's nested-disclosure quiet rounds.
- Traverses down → up → verifies the oldest edge → down, then performs bounded retained-disclosure reconciliation when necessary.
- Allows up to 2,000 steps per directional traversal.
- Requires six stable endpoint observations and twelve stable top observations for oldest-edge convergence, with a 180-check safety limit.
- Retains visible timestamp/date separators and **Branched from** notices across virtualization.
- Preserves exposed message IDs and visible timestamp labels as archive metadata.
- Preserves formula source and renders formulas as native MathML, with visible TeX fallback when rendering fails.
- Recursively captures mounted app-block iframe trees and flattens them into static HTML.
- Preserves meaningful non-formula SVG and embeds retrievable raster references.
- Retains successful main-chat image response bytes during crawling, resolves mounted blob images early, and uses final URL fetching only as fallback.
- Preserves captured image display and intrinsic dimensions when available.
- Uses the shared conversation title as the downloaded filename after cross-platform sanitization.
- Generates live preview only while a preview window is explicitly open.
- Keeps an independent worker heartbeat approximately every two seconds.
- Supports cancellation and cleans old completed jobs from memory.
- Includes Windows, Linux and macOS setup/start scripts.

## Status interface

The local job panel is intentionally stage-oriented rather than pretending the entire crawl has a knowable global percentage.

Visible fields are:

- **Stage** — loading, traversing, oldest-message verification, retained-disclosure reconciliation, diagnostic validation in development builds, final assembly, or complete.
- **Current action** — one concise statement of the current operation.
- **Coverage** — retained turns / observed mounted turn IDs / observed-but-unretained turns.
- **Oldest retained** — the earliest turn already present in the retained corpus.
- **Position in loaded content** — current scroll position within ChatGPT's *currently loaded* scroll range. This is not overall conversation completion.
- **Disclosure activity** — shown only while a disclosure turn is being expanded or waiting for nested content.
- **Worker heartbeat** — independent liveness signal.
- **Last substantive progress** — durable archive-state progress rather than ordinary virtualizer movement.

Progress bars are local to the current stage. Directional traversal reflects progress through that pass; oldest-edge verification reflects stable top checks; reconciliation reflects the active reconciliation traversal; loading/finalization are indeterminate.

`Last substantive progress` does not reset merely because `mountedFirst`, `mountedLast`, or scroll height changes. A development build waiting for human validation suppresses the ordinary no-progress warning, but heartbeat monitoring remains active.

## Requirements

- Windows, Linux, or macOS
- Node.js 20 or newer
- npm
- Internet access while crawling
- A graphical desktop session for interactive authenticated login/verification
- Enough memory for Chromium, retained HTML and embedded resources

## Quick start

### Windows

```text
setup-windows.bat
start-windows.bat
```

### Linux

```bash
./setup-linux.sh
./start-linux.sh
```

### macOS

```bash
./setup-macos.sh
./start-macos.sh
```

The UI normally opens at `http://localhost:3000`. The server binds to `127.0.0.1` by default. Do not expose it to untrusted networks when a saved authenticated profile exists.

## Authenticated browser profile

The profile is stored at:

```text
./browser-profile
```

Use **Open ChatGPT login** to launch Playwright's bundled Chromium as a standalone OS process using that profile. Playwright does not control the login browser while you sign in. Close that browser when authentication is complete; the crawler then briefly checks the saved profile under Playwright.

Authenticated archive jobs subsequently use a headed persistent Playwright context backed by the same profile. Access is serialized so two crawler operations cannot race the same Chromium user-data directory.

The profile can contain authentication cookies/browser storage. Treat it as credential-equivalent local state. It is excluded from Git and archive output.

The unmanaged login browser itself is intentionally not patched. Headed persistent archive/session-check Chromium contexts use these flags so rendering does not slow simply because the window is minimized or occluded:

```text
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
```

## Traversal and retention

Automatic capture proceeds as:

```text
Pass 1 down
Pass 2 up
Oldest-edge verification
Pass 3 down
Retained-disclosure reconciliation if required
Final mounted disclosure sweep
Final static archive assembly
```

Every mounted turn is retained in an in-page map keyed by `conversation-turn-*`. The mount observer independently records every turn ID actually seen. A healthy completed crawl should report zero **observed but unretained** turns.

The crawler does not infer completeness from numerical turn IDs being contiguous. Coverage means every turn ID that the browser actually exposed and the observer actually saw has a retained candidate.

## Disclosure convergence

Once the crawler activates a disclosure, that turn becomes the convergence scope. It repeatedly:

1. expands one eligible disclosure in that turn;
2. waits for its controlled target/turn hydration to settle;
3. retains the richer active turn;
4. rescans that same turn for descendants;
5. requires three matching turn-scoped quiet rounds when no descendant remains actionable.

Unrelated messages entering or leaving ChatGPT's virtualized viewport do not participate in that signature. A turn-local safety timeout prevents animation/renderer instability from blocking traversal indefinitely; later passes can revisit the retained target.

## App blocks

Generated app previews can contain nested iframes. While an app block is mounted, the crawler recursively serializes frame bodies, inlines bounded computed presentation properties, removes executable behavior, follows nested frames, and replaces the live iframe tree with ordinary static HTML.

Retrievable app `<img>`, SVG `<image>`, CSS background-image and readable canvas resources are converted to embedded data where possible before the owning frame disappears.

Current bounds include:

- 50 app blocks;
- 8 nested frame levels;
- 8 MiB structural HTML per captured frame/block snapshot;
- 64 MiB total retained structural app HTML;
- 32 MiB per raster asset;
- 256 MiB total embedded raster source bytes.

## Images and SVG

Main-conversation image handling prioritizes bytes captured while the page is live. It then uses mounted blob capture, credentialed browser fetch where applicable, and Playwright request fallback. MIME type is sniffed from actual bytes for common image formats rather than blindly trusting HTTP headers.

Static meaningful SVG outside formulas/app blocks is retained through an explicit static SVG allow-list. Decorative toolbar chrome is not treated as archival content.

## Formulas

The crawler preserves authoritative TeX exposed by ChatGPT, tokenizes it before generic sanitization, and renders it as MathML with local KaTeX. Unrenderable formulas show the original TeX visibly instead of disappearing.

## Development diagnostic build

`v1.6.7-beta10-dev` is intentionally diagnostic. It keeps the high-density Chromium MHTML recorder and, after an authenticated automatic crawl, runs two manual validation turns selected dynamically from the untouched automatic retained corpus.

The target selector ignores generic collapsed controls such as image viewers. It prioritizes recognized reasoning/tool disclosures, then assistant reasoning/tool turns, then rich assistant tool/code turns. No conversation-turn ID is hard-coded.

Anonymous automatic crawling uses the same crawler routines but skips the human validation phase.

The immediately following `v1.6.7-beta10` release removes the MHTML recorder and manual-validation runtime while retaining the same automatic crawler and interface.

## Static output and archive metadata

The final archive contains no scripts. It preserves retained semantic turn content, code, links, tables, blockquotes, MathML formulas, timeline/branch markers, embedded images, flattened app-block content, and static SVG.

The archive header reports one **Disclosures expanded** field. When click attempts equal confirmations, only the confirmed count is shown. When they differ, both are reported in that one field so retries remain visible.

## Limitations

All current limitations are documented here rather than in a separate limitations file.

The crawler does **not**:

- bypass ChatGPT account, workspace, share-link or authorization restrictions;
- currently accept arbitrary private `/c/...` conversation URLs as input; input validation remains `/share/...` only;
- recover content the selected anonymous/authenticated share browser never exposes;
- recover private model-internal chain-of-thought;
- infer timestamps that ChatGPT does not display;
- reliably reconstruct original user-uploaded filenames when the shared page omits them;
- preserve app blocks as interactive applications—the archive is static;
- guarantee image recovery after every early/fallback embedding path and the original remote URL have failed;
- guarantee that Google/other identity providers accept Playwright's bundled Chromium for every SSO policy;
- guarantee compatibility with future ChatGPT DOM, virtualization, auth or share-page changes without maintenance.

The exact differences between what anonymous and authenticated share views expose—especially upload/image names and app-block resources—are deliberately **not generalized yet**. They will be documented from matched diagnostic evidence before v1.7.

## Security model

- only HTTPS `chatgpt.com/share/...` input;
- anonymous mode uses a disposable context;
- authenticated mode uses only the user-controlled local `./browser-profile`;
- standalone manual login occurs on the real ChatGPT site;
- browser profile is ignored by Git and never inserted into archive HTML;
- local server binds to loopback by default;
- final archive contains no copied ChatGPT scripts or live app iframes;
- app forms/event handlers are removed;
- KaTeX untrusted features are disabled.

## Development checks

The GitHub release workflow syntax-checks Node source and inline browser scripts, then runs every `tests/*.mjs` runtime smoke test before packaging a release.

Important regressions include:

- long virtualized conversation coverage with zero observed-but-unretained turns;
- deeply nested reasoning/tool expansion;
- remounted disclosure retry reset;
- turn-scoped convergence under unrelated virtualizer churn;
- oldest-edge verification and safety-limit reporting;
- retained-disclosure reconciliation;
- app-block iframe/resource flattening;
- blob/signed/MIME-mislabeled image embedding;
- formulas and non-formula SVG;
- session/profile locking and background rendering;
- dynamic development diagnostic target selection that ignores generic image controls.

## Recent version history

- `v1.6.7-beta7-dev2.4(.1)` — disclosure retry reset, retained-corpus reconciliation, MHTML diagnostic cleanup.
- `v1.6.7-beta8-dev` — turn-scoped disclosure convergence and major traversal performance recovery.
- `v1.6.7-beta9` — mount-triggered turn retention, restoring complete short-turn coverage without reintroducing viewport-wide stabilization.
- `v1.6.7-beta10-dev` — dynamic diagnostic target selection, stage-local status UI, corrected substantive-progress semantics, common Chromium background bootstrap; full MHTML/manual diagnostics retained.
- `v1.6.7-beta10` — same automatic crawler/UI with MHTML and manual validation removed.

## Maintenance note

ChatGPT's frontend and authentication flow are not stable public APIs. Prefer observable user-facing structure—conversation-turn boundaries, accessibility disclosure state, visible markers, app-preview structure, mounted-scroll behavior and browser-session evidence—over generated CSS classes or presentation-only labels.
