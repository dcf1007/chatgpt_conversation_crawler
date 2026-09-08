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

The beta10-dev comparison below uses the same shared conversation in both modes and therefore provides direct evidence about what the page exposed to each browser rather than assuming that authentication only changes login state.

## Anonymous vs authenticated share evidence

A matched `v1.6.7-beta10-dev` run on the same 60-turn share was captured once anonymously and once with the saved authenticated ChatGPT profile. Both modes used the same automatic crawler code.

The broad conversation structure matched: both archives retained **60 turns**, **3 timeline markers**, and the same **180/181 formulas rendered as MathML**. The meaningful differences came from resources and tool/app content that ChatGPT exposed only to the authenticated browser.

| Content | Authenticated share | Anonymous share |
| --- | --- | --- |
| Conversation turns | 60 | 60 |
| Timeline markers | 3 | 3 |
| Formula rendering | 180/181 | 180/181 |
| App blocks | 1 captured, 2 flattened frames, 2 SVGs | no usable app block; placeholder only |
| Main image sources reported by crawler | 8/8 embedded | 4/4 embedded |
| User-upload image DOM | actual `<img>` elements with signed `oaiusercontent.com` URLs and dimensions | generic `Uploaded an image` placeholders, no image URL/bytes |
| Original uploaded-image filename | not exposed; generic `Uploaded image` label only | not exposed |
| User-uploaded non-image filename | generic `Uploaded a file`; original name not exposed | generic `Uploaded a file`; original name not exposed |
| Rich tool/execution transcript | some authenticated-only tool payloads are exposed | corresponding payload can be omitted |

### User-uploaded images

In the authenticated MHTML, four user-uploaded images were directly retrievable from signed `oaiusercontent.com` URLs. The share DOM exposed image dimensions as well:

- one image in turn 27: `850 × 129`;
- three images in turn 37: `360 × 500`, `2048 × 1636`, and `1286 × 700`.

The anonymous view exposed no corresponding image resources. It showed textual placeholders such as `Uploaded an image` instead.

Authentication therefore changes whether the **image bytes and dimensions** are retrievable from this share. It did **not** recover the original image filenames: even the authenticated DOM used only generic labels such as `Uploaded image` and `Open image 1 of 3: Uploaded image`.

### User-uploaded files

For the two uploaded non-image files in turn 37, both modes exposed only `Uploaded a file`. No original attachment filename was present in the matched DOM snapshots. Filenames that appear elsewhere in the conversation because the user typed them or because a tool printed a local path are conversation text, not recovered attachment metadata.

### App blocks

The authenticated page exposed an app-preview iframe plus its sandbox document/CSS. The crawler flattened that into one static app block containing two frame levels and two SVGs.

The anonymous page did not expose the sandbox app resources. The resulting static archive therefore contained `App block preview could not be captured` instead of the rendered visualization. This is a source-availability difference, not a separate anonymous crawler algorithm.

### Tool/execution content

Authentication also exposed materially richer tool content in at least one assistant turn. In turn 18, the authenticated static archive retained roughly 41.8k characters and included a large visible `Analysis errored` Python/tool payload, while the anonymous archive retained roughly 3.4k characters and omitted that payload. Smaller authenticated-only `Run` labels also appeared in several tool-heavy turns.

This should be treated as **user-visible share content exposed differently by ChatGPT**, not as private model-internal chain-of-thought recovery.

### Known beta10 archive gap discovered by this comparison

The authenticated MHTML proves that the four user-uploaded image bytes were available to the browser, but the beta10 static archive does not render those uploaded-image elements back inside the corresponding user messages. The image cache/statistics can therefore report retrievable embedded sources even though the final retained turn HTML does not visibly contain those attachments.

That is a real archival-fidelity issue to address in v1.7. It is separate from the anonymous limitation: anonymous mode never received those image bytes in the first place.

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

The selector fix is validated by the matched run: it chose turns 44 and 38, both rich reasoning/tool turns, instead of the generic image-control turn that had incorrectly won under the old selector.

The untouched automatic baseline already retained turn 44 at 87 `<pre>` / 82 `<code>` and turn 38 at 61 `<pre>` / 52 `<code>`. The retained HTML for both selected turns was byte-identical in the automatic baseline, after each manual step, and in the final post-manual snapshot. Human expansion changed the currently mounted virtualizer state but did not improve those retained turn copies. This supports the current richest-turn retention and turn-scoped convergence behavior.

Anonymous automatic crawling uses the same crawler routines but skips the human validation phase.

The clean `v1.6.7-beta10.1` release removes the MHTML recorder and manual-validation runtime while retaining the same automatic crawler and interface. `beta10.1` also fixes the clean platform launchers so Windows, Linux and macOS start `server.mjs` rather than the removed development launcher.

## Static output and archive metadata

The final archive contains no scripts. It preserves retained semantic turn content, code, links, tables, blockquotes, MathML formulas, timeline/branch markers, embedded images that remain represented in retained output, flattened app-block content, and static SVG.

The archive header reports one **Disclosures expanded** field. When click attempts equal confirmations, only the confirmed count is shown. When they differ, both are reported in that one field so retries remain visible.

## Limitations

All current limitations are documented here rather than in a separate limitations file.

The crawler does **not**:

- bypass ChatGPT account, workspace, share-link or authorization restrictions;
- currently accept arbitrary private `/c/...` conversation URLs as input; input validation remains `/share/...` only;
- recover content the selected anonymous/authenticated share browser never exposes;
- recover private model-internal chain-of-thought;
- infer timestamps that ChatGPT does not display;
- recover original user-uploaded image/file names when the share page supplies only generic upload labels;
- make anonymously unavailable uploaded-image bytes or app-sandbox resources appear by using the authenticated capture paths;
- currently guarantee that every authenticated uploaded-image source retained in the image cache is represented again inside the final static turn HTML; this is a known beta10 fidelity gap planned for v1.7;
- preserve app blocks as interactive applications—the archive is static;
- guarantee image recovery after every early/fallback embedding path and the original remote URL have failed;
- guarantee that Google/other identity providers accept Playwright's bundled Chromium for every SSO policy;
- guarantee compatibility with future ChatGPT DOM, virtualization, auth or share-page changes without maintenance.

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
- dynamic development diagnostic target selection that ignores generic image controls;
- clean platform launchers that never depend on removed development-only startup files.

## Recent version history

- `v1.6.7-beta7-dev2.4(.1)` — disclosure retry reset, retained-corpus reconciliation, MHTML diagnostic cleanup.
- `v1.6.7-beta8-dev` — turn-scoped disclosure convergence and major traversal performance recovery.
- `v1.6.7-beta9` — mount-triggered turn retention, restoring complete short-turn coverage without reintroducing viewport-wide stabilization.
- `v1.6.7-beta10-dev` — dynamic diagnostic target selection, stage-local status UI, corrected substantive-progress semantics, common Chromium background bootstrap; full MHTML/manual diagnostics retained.
- `v1.6.7-beta10` — clean diagnostic-removal build; initial release had stale platform launchers.
- `v1.6.7-beta10.1` — corrected clean launchers; same automatic crawler as beta10-dev without MHTML/manual capture.

## Maintenance note

ChatGPT's frontend and authentication flow are not stable public APIs. Prefer observable user-facing structure—conversation-turn boundaries, accessibility disclosure state, visible markers, app-preview structure, mounted-scroll behavior and browser-session evidence—over generated CSS classes or presentation-only labels.
