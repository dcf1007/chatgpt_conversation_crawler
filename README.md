# ChatGPT Conversation Crawler

A local Node.js + Playwright utility that turns a ChatGPT **shared conversation** into a readable, script-free static HTML archive.

It is designed for long conversations where a normal browser save can miss content because ChatGPT lazily loads history, virtualizes conversation turns, and mounts reasoning/tool/code sections only after user-visible disclosures are expanded.

> **Boundary:** the crawler archives content that the shared page exposes to an ordinary browser. It does not recover private chain-of-thought, hidden account data, private application state, or content that the share page does not expose.

## Features

- Accepts only `https://chatgpt.com/share/...` URLs.
- Uses a clean Playwright Chromium browser context.
- Detects ChatGPT's internal conversation scroller instead of assuming `window` scrolls.
- Progressively retains virtualized turns so previously seen content is not lost.
- Retains visible timeline metadata between turns, including date/time separators and **Branched from** ancestry notices.
- Associates retained timeline markers with the following `conversation-turn-*` so virtualization cannot discard them after they scroll out of the DOM.
- Preserves message UUIDs and visible timestamp labels as machine-readable archive attributes when available.
- Expands native `<details>` and conversation-scoped `aria-expanded="false"` disclosures.
- Recognizes parent controls such as **Worked for**, **Thought**, **Thinking**, and **Reasoning** even without `aria-controls`.
- Avoids obvious menu controls such as `aria-haspopup` and `role="menuitem"`.
- Retains richer versions of turns, prioritizing fully expanded content, `<pre>`, `<code>`, text, and HTML size.
- Performs down → up → strict oldest-edge verification → down traversal.
- Scans up to **2,000 steps per directional pass**.
- Requires **6 stable observations** at ordinary scan endpoints.
- Requires **12 consecutive stable observations while actually at the top** before oldest-message discovery is considered converged.
- Reports the actual result if the **180-check oldest-edge safety limit** is reached instead of falsely reporting 12/12 convergence.
- Keeps **Detail**, **Scanning**, **Oldest retained**, **Mounted first**, and **Expanding** as separate persistent diagnostics.
- Maintains an independent worker heartbeat every ~2 seconds.
- Does not treat ordinary scan-step movement by itself as substantive progress.
- Treats mounted-first/mounted-last virtualizer changes and newly retained timeline markers as substantive progress.
- Generates live-preview snapshots only while a preview window is active.
- Detects the shared conversation name from the page `<title>` and uses it for the downloaded HTML filename when available.
- Preserves ChatGPT formula source and renders inline/display formulas as native **MathML** in live previews and final archives, with visible original-TeX fallback if rendering fails.
- Embeds retrievable HTTP(S) **and `blob:` images** into the final HTML as data URLs.
- Preserves captured image display dimensions and intrinsic dimensions when available.
- Falls back to the original image URL and records diagnostics when an image cannot be embedded.
- Preserves assistant-generated download names when they are visibly present in the shared conversation; it does not infer missing names for user-uploaded files or images.
- Supports cancellation and automatically cleans old completed jobs from memory.
- Includes setup/start scripts for **Windows, Linux, and macOS**.
- Publishes finished versions automatically as GitHub Releases with a cross-platform ZIP asset.

## Requirements

- Windows, Linux, or macOS
- Node.js **20 or newer**
- npm for the active Node.js installation
- Internet access while crawling the ChatGPT share URL
- Enough memory for Chromium plus progressively retained conversation HTML/images

## Downloading a release

Finished versions are published as formal GitHub Releases. Download the versioned cross-platform ZIP from the repository's **Releases** page, for example:

```text
chatgpt-conversation-crawler-v1.6.3.zip
```

The release workflow reads the version from `package.json`, creates a `vX.Y.Z` release when that version is new, and attaches a ZIP made from that exact commit.

## Quick start

### Windows

Run once:

```text
setup-windows.bat
```

Then start with:

```text
start-windows.bat
```

The Windows launcher starts `node server.mjs` directly and avoids the project-local npm-resolution issue that affected an earlier version.

### Linux

```bash
./setup-linux.sh
./start-linux.sh
```

On apt-based systems setup attempts Playwright's Chromium system-dependency installation. If archive extraction removes executable permissions:

```bash
chmod +x setup-linux.sh start-linux.sh
```

### macOS

```bash
./setup-macos.sh
./start-macos.sh
```

If necessary:

```bash
chmod +x setup-macos.sh start-macos.sh
```

The local UI normally opens at:

```text
http://localhost:3000
```

The server also reads the `PORT` environment variable.

## Usage

1. Create/copy a ChatGPT shared-conversation URL.
2. Paste it into the local crawler UI.
3. Click **Start archive**.
4. Watch the persistent status fields while the crawler runs, including the detected **Chat name** and retained **timeline markers** count.
5. Optionally click **Open live preview**. It is never opened automatically.
6. When the job reaches **Complete**, download the generated static HTML. The detected chat name is used as the filename when available.

## Understanding the progress page

The status panel deliberately separates different concepts:

- **Chat name** — the conversation name detected from the shared page `<title>`; it is also used for the download filename when available.
- **Phase** — the high-level lifecycle: loading, scanning, oldest verification, final expansion, building, complete.
- **Detail** — the current operation or wait explanation. It does not duplicate the scan step.
- **Scanning** — current pass, direction, step, mounted-range position, mounted-first frontier, endpoint stability, or oldest-edge probe state.
- **Oldest retained** — the numerically earliest `conversation-turn-*` that has ever been stored in the cumulative progressive-capture map. Once turn 1 is captured, this is expected to remain `conversation-turn-1`.
- **Mounted first** — the earliest `conversation-turn-*` currently mounted by ChatGPT's virtualizer. This is the live frontier that can move while scrolling/loading.
- **Expanding** — the most recent disclosure/tool/reasoning row being opened.
- **Timeline markers** — visible timestamp/date separators plus **Branched from** ancestry notices retained between conversation turns.
- **Worker heartbeat** — an independent liveness signal updated approximately every two seconds.
- **Last substantive progress** — meaningful capture/virtualizer changes, not ordinary step-number changes.

The mounted-range percentage is diagnostic only. ChatGPT can mount and unmount content while the crawler moves, so scroll height is not a trustworthy overall completion percentage.

## Chat name and download filename

Actual ChatGPT shared-link pages expose the conversation name in the document `<title>`. The crawler reads that title after the share page has loaded and rejects generic values such as `ChatGPT` or `Check out this chat`.

The detected title is shown in the local status UI and is used for the downloaded `.html` filename. Filename generation:

- preserves Unicode when the browser supports RFC 5987 filenames;
- removes control characters and characters invalid on Windows (`<>:"/\\|?*`);
- trims trailing spaces/dots;
- avoids Windows reserved device names such as `CON`, `NUL`, `COM1`, and `LPT1`;
- caps the base name length;
- falls back to `chatgpt-share-<job-id>.html` if no meaningful title is available.

The Open Graph title is intentionally not used because current shared pages can expose the generic value `Check out this chat` there while the real conversation name is present in `<title>`.

## User-uploaded file and image names

ChatGPT shared-conversation pages can omit the original filenames of files and images uploaded by the user. When the shared page does not expose a filename in its rendered DOM or other browser-visible content, the crawler cannot recover it reliably.

The crawler therefore does **not** attempt to reconstruct missing upload names from image URLs, runtime paths, message order, generated identifiers, or other heuristics. Such guesses can be wrong and add crawl/convergence overhead without recovering authoritative metadata.

Assistant-generated download names that are visibly present in the shared conversation are still archived as ordinary visible conversation content by the existing static-output sanitizer. No separate filename-tracking subsystem is required for those names.

## Formulas and MathML

Current ChatGPT pages expose formula source on `role="math"` elements through `data-math-source` and/or `aria-label`, while the visual KaTeX subtree can be marked `aria-hidden="true"`. A generic static sanitizer that removes hidden presentation DOM can therefore leave an empty formula wrapper even though the authoritative TeX source was present.

Before sanitization, the crawler now extracts that source and replaces each formula with a randomized archive token. Snapshot finalization renders each unique inline/display expression with the local KaTeX package using **MathML-only output**. The resulting archive remains script-free and does not depend on ChatGPT's KaTeX CSS, JavaScript, or webfonts.

The archive retains the original source in `data-math-source`. Display formulas are kept as block math; inline formulas remain inline. KaTeX is invoked with `trust: false` and bounded macro expansion. If a particular expression cannot be converted, the archive shows the escaped original TeX and records a diagnostic instead of silently dropping the formula.

Formula conversion runs for both live previews and final archives. Image embedding remains a separate finalization step.

## Traversal and convergence

The sequence is:

```text
Pass 1: down
    ↓
Pass 2: up
    ↓
Verify oldest edge
    ↓
Pass 3: down
    ↓
Final expansion sweep
    ↓
Build final archive + embed images
```

### Directional passes

Each directional pass can use up to **2,000 steps**. Upward traversal is intentionally denser than downward traversal and waits longer between moves because historical lazy loading is the more fragile direction.

At an endpoint, the crawler does not stop immediately. It requires six matching observations using a signature that includes:

- scroll position and height;
- retained turn count;
- oldest/newest retained turn IDs;
- first/last currently mounted turn IDs;
- clicks, confirmed expansions, and failures;
- retained `<pre>` and `<code>` counts;
- retained timeline-marker count.

This is deliberately conservative: a virtualizer can change which turns or between-turn markers are mounted without changing the total retained turn count.

### Oldest-message verification

The crawler repeatedly returns to the real top edge and waits for older content to appear. A quiet observation counts only while the conversation is actually at the top (`scrollTop <= 4`).

The oldest-edge signature includes actual top offset, scroll height, retained/mounted boundaries, turn/code counts, timeline-marker count, clicks, confirmed expansions, and failures. Any change resets the quiet counter. Twelve consecutive unchanged top observations are required.

After a few quiet checks, the crawler deliberately nudges roughly 38% of a viewport away from the top (minimum 220 px where possible) and returns. This can retrigger virtualizer or `IntersectionObserver` boundaries that do not fire while parked continuously at `scrollTop = 0`.

The top settling wait is intentionally conservative, and live-preview reconstruction is completely paused during this phase.

The verification loop also has a **180-check safety limit**. If that limit is reached before 12 quiet checks, the crawler continues rather than throwing away an otherwise useful capture, but it does **not** claim convergence. The UI and final archive record the actual stable-check count and a prominent warning.

## Timeline timestamps and branch ancestry

ChatGPT can render timestamp/date separators outside the message turn itself, for example:

```html
<div aria-label="Today 9:09 AM" role="separator">…</div>
```

or a more explicit label such as `Sun, Aug 16 at 10:34 AM`. These are retained **exactly as displayed by ChatGPT**; the crawler does not invent or infer hidden timestamps. Relative labels such as `Today` therefore remain relative text in the archive rather than being silently converted to a guessed absolute date.

The crawler also retains visible ancestry notices such as:

```text
Branched from Branch · Branch · Branch · Image Circle Detection
```

including the linked source-conversation URL when ChatGPT exposes one. Timestamp and branch markers are stored independently of the turn HTML and keyed to the following `conversation-turn-*`. This means they survive progressive virtualization even after the original marker DOM node is unmounted.

When available, the following turn also receives machine-readable archive attributes:

- `data-message-id` for ChatGPT's exposed message UUID;
- `data-timestamp-label` for the retained visible timestamp label.

These attributes are preservation metadata, not a claim that ChatGPT exposes an absolute creation timestamp for every message.

## Disclosure expansion

Expansion is scoped to actual conversation turns:

```css
section[data-testid^="conversation-turn-"]
```

A collapsed control is eligible when it structurally controls content (`aria-expanded="false"` plus `aria-controls`), regardless of generated label text. Parent reasoning controls beginning with forms of `Worked for`, `Thought`, `Thinking`, or `Reasoning` are also eligible without `aria-controls`.

Obvious menu controls are excluded. Each click is confirmed; a disclosure that remains collapsed after three attempts is recorded as a failure instead of silently counted as successful.

The final expansion sweep allows up to **500** remaining mounted disclosures.

Expansion status is lightweight: the **Expanding** line is updated for each disclosure, while complete retained-turn statistics/scroll metrics are recomputed every eight expansions and at the end of each sweep. This keeps the UI responsive without recreating the v1.5.1 per-click reporting overhead.

## Progressive capture

Long ChatGPT conversations can virtualize old DOM nodes out of the document. The crawler therefore does not wait until the end and copy only the final live DOM.

Every encountered conversation turn is retained in an in-page map keyed by its `conversation-turn-*` ID. If the same turn is encountered later in a richer state, the retained copy is replaced. Between-turn timestamp/branch markers are retained in a separate cumulative map and associated with the next turn in document order.

The richness score strongly favors, in order:

1. no remaining detected collapsed disclosures;
2. more `<pre>` blocks;
3. more `<code>` elements;
4. more text;
5. larger retained HTML.

## Live preview performance

The live preview is demand-driven rather than continuously generated.

- **No preview window open:** no preview snapshots are constructed.
- **Preview window open:** it signals activity while polling status.
- Full preview serialization is normally limited to at least **20 seconds** between builds.
- If the material capture signature has not changed, rebuilding can be deferred up to **45 seconds**.
- During oldest-edge verification, preview generation is paused completely.
- Closing the preview stops its activity signal; preview generation automatically becomes inactive shortly afterward.

Preview images remain external URLs to keep preview reconstruction lightweight. The final archive performs image embedding once after crawling is complete.

## Heartbeat and substantive progress

The worker heartbeat is maintained independently of crawler state at approximately two-second intervals. This means a long wait or final image-embedding operation does not make an otherwise healthy worker look dead.

`Last substantive progress` intentionally excludes the changing scan step/status string. The step remains fully visible under **Scanning**. Substantive progress is driven by capture state such as phase transitions, retained-turn/code/expansion/failure changes, oldest/newest retained boundaries, **mounted-first/mounted-last virtualizer changes**, newly retained timeline markers, and growth in the maximum observed scroll height.

## Embedded images and image dimensions

During capture, each live image is resolved to its current source URL. When available, the crawler also records:

- displayed width/height from `getBoundingClientRect()`;
- intrinsic `naturalWidth` / `naturalHeight`.

The static archive preserves the displayed `width` and `height`, and stores intrinsic dimensions in `data-natural-width` and `data-natural-height`.

At finalization, unique image sources are converted to `data:` URLs:

- HTTP(S) images are fetched through Playwright's browser-context request client;
- `blob:` images are resolved inside the still-open ChatGPT page and read as data URLs before Chromium closes;
- duplicate URLs are processed once.

Current embedding safety limits are:

- **32 MiB per image**;
- **256 MiB total embedded source bytes**;
- up to four image fetch/resolve operations concurrently.

If an image cannot be embedded, the final archive retains the original source string where possible and adds an image-embedding diagnostic. Image placeholder tokens use a randomized namespace to avoid collisions with ordinary conversation/code text.

## Static output fidelity

The final archive is script-free but preserves readable semantic content and richer archival structure, including:

- role-specific turn classes;
- `data-turn` conversation IDs;
- exposed message UUIDs when available;
- visible timestamp separators and their original `aria-label` text;
- **Branched from** ancestry dividers and links;
- dedicated `.archive-turn-content` wrappers;
- reasoning labels converted to static text;
- prose, lists, headings, tables and links;
- native MathML for ChatGPT formulas, with original TeX retained and visible TeX fallback on conversion errors;
- `<pre>` and `<code>` plus inline-code styling;
- blockquote styling;
- responsive images/video;
- disclosure, formula-rendering, oldest-edge and image-embedding diagnostics;
- archive metadata and scope statement;
- print-oriented styling.

## Cancellation and cleanup

Cancellation sets a cancellation flag **and closes the active Playwright browser**, allowing it to interrupt page loading or long crawler waits. The worker checks cancellation again before committing the final archive so a cancelled job cannot race into the completed state.

Completed/error/cancelled jobs are stored in memory temporarily and automatically removed after roughly one hour.

## HTTP API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/archive/start` | Start a tracked archive job |
| `GET` | `/api/archive/status/:id` | Poll phase, counters, heartbeat and persistent status fields |
| `GET` | `/api/archive/status/:id?preview=1` | Status polling from an open preview window; also acts as the preview activity signal |
| `GET` | `/api/archive/preview/:id` | Retrieve the current preview HTML |
| `GET` | `/api/archive/download/:id` | Download final HTML after completion |
| `POST` | `/api/archive/cancel/:id` | Cancel the job and close its active browser |

The old synchronous `POST /api/archive` compatibility endpoint is intentionally **not** restored. The tracked-job API is more robust for long crawls and avoids holding one HTTP request open for the whole operation.

## Security model

- only HTTPS `chatgpt.com/share/...` URLs are accepted;
- arbitrary hosts are rejected;
- Playwright uses a clean browser context rather than the user's browser profile;
- formula conversion uses local KaTeX MathML generation with untrusted features disabled;
- the final HTML contains no copied ChatGPT scripts;
- the local server has no authentication layer because it is designed as a local utility.

Do not expose the local server port to untrusted networks.

## What the project does not do

It does not:

- authenticate into a private ChatGPT account;
- bypass workspace/share restrictions;
- recover content the share page does not expose;
- infer timestamps that ChatGPT does not visibly expose;
- reconstruct original filenames of user-uploaded files or images when the shared page omits them;
- extract private model-internal chain-of-thought;
- preserve ChatGPT as an interactive application;
- guarantee compatibility with future ChatGPT DOM changes without maintenance.

## Development checks

```bash
node --check server.mjs
node --check src/crawler.mjs
node --check src/snapshot.mjs
bash -n setup-linux.sh start-linux.sh setup-macos.sh start-macos.sh
```

For crawler changes, test at least:

1. a short conversation;
2. `<pre><code>` content;
3. arbitrary generated-label `aria-controls` disclosures;
4. a **Worked for ...** parent disclosure;
5. a heavily virtualized long thread;
6. delayed oldest-turn loading and the 180-check safety limit;
7. cancellation;
8. live preview open and closed;
9. HTTP(S) image embedding;
10. `blob:` image embedding and fallback behavior;
11. **Oldest retained** vs **Mounted first** behavior during virtualization;
12. timestamp separators such as `Today 9:09 AM` and explicit calendar labels;
13. **Branched from** ancestry markers and source links;
14. inline and display formulas containing fractions, roots, subscripts/superscripts, and a forced invalid-TeX fallback case.

## Version history

- **v1.0.0** — initial share archiver.
- **v1.1.0** — structural disclosure handling, internal scroller, progressive capture and Windows scripts.
- **v1.1.1** — Windows npm-launcher fix.
- **v1.2.0** — tracked jobs, live status/preview, cancellation and deferred download.
- **v1.3.0** — dedicated oldest-message convergence.
- **v1.3.1** — persistent Scanning / Oldest retained / Expanding plus separate Detail.
- **v1.4.0** — Linux and macOS launchers and cross-platform release ZIP.
- **v1.4.1** — clarified Detail/Scanning semantics, stale-pass fix and manual-only preview opening.
- **v1.5.0** — restored/strengthened the conservative v1.3 crawler safeguards, increased directional scan ceiling to 2,000, added demand-driven preview, independent heartbeat, stronger cancellation/cleanup, higher-fidelity static output and embedded final images.
- **v1.5.1** — documentation reconciliation and a small image-fallback escaping correction.
- **v1.5.2** — truthful oldest-edge safety-limit reporting, mounted-frontier diagnostics and substantive-progress tracking, lightweight per-expansion reporting, randomized image tokens, and `blob:` image embedding.
- **v1.5.3** — detects the real shared-chat title and uses a cross-platform sanitized version as the downloaded HTML filename, with the detected name exposed in status.
- **v1.6.0** — retains visible timestamp/date separators and **Branched from** ancestry markers across virtualization, preserves exposed message IDs/timestamp labels, and renders those markers in live/final archives.
- **v1.6.1** — keeps **Expanding** coherent with the currently mounted range and emits fresh retained/mounted boundaries on lightweight expansion updates.
- **v1.6.2** — documents that shared links can omit original user-uploaded file/image names; no runtime filename inference or tracking is added.
- **v1.6.3** — preserves ChatGPT formula TeX before sanitization, renders formulas as native MathML in preview/final archives, and falls back to visible source TeX with diagnostics if rendering fails.

## Maintenance note

ChatGPT's frontend is not a stable public DOM API. Prefer adapting to user-facing structural semantics—conversation-turn boundaries, accessibility disclosure state, visible timeline markers, and mounted-scroll behavior—rather than generated CSS class names.