# ChatGPT Conversation Crawler

A local Node.js + Playwright utility that turns a ChatGPT **shared conversation** into a readable, script-free static HTML archive.

It is designed for long conversations where a normal browser save can miss content because ChatGPT lazily loads history, virtualizes turns, mounts reasoning/tool/code sections on demand, and can render generated visual content inside nested app-preview iframes.

> **Boundary:** the crawler archives content that the shared page exposes to the browser mode you choose. It does not recover private chain-of-thought, bypass account/workspace permissions, or recover content that ChatGPT does not expose to that browser session.

## Features

- Accepts only `https://chatgpt.com/share/...` URLs.
- Supports a clean **Anonymous** browser mode and an optional persistent **Authenticated** ChatGPT browser profile.
- For manual sign-in, launches Playwright's bundled Chromium executable as a standalone OS process with no Playwright connection to the login browser.
- Stores the persistent profile locally at `./browser-profile`, beside the setup/start scripts, and reuses its cookies/browser storage across crawler restarts until ChatGPT expires or revokes the session.
- Serializes authenticated jobs so only one browser process uses the persistent profile at a time.
- Can check the saved ChatGPT session, close the login browser, or delete the saved profile from the local UI.
- Detects ChatGPT's internal conversation scroller instead of assuming `window` scrolls.
- Progressively retains virtualized turns so previously seen content is not lost.
- Retains visible timestamp/date separators and **Branched from** ancestry notices across virtualization.
- Preserves exposed message UUIDs and visible timestamp labels as archive metadata.
- Expands conversation-scoped disclosures, including native `<details>` and reasoning/tool controls.
- Performs down → up → strict oldest-edge verification → down traversal.
- Scans up to **2,000 steps per directional pass**.
- Requires **6 stable observations** at ordinary endpoints.
- Requires **12 consecutive stable observations while actually at the top** for oldest-edge convergence, with a **180-check safety limit**.
- Keeps **Detail**, **Scanning**, **Oldest retained**, **Mounted first**, and **Expanding** as separate diagnostics.
- Maintains an independent worker heartbeat approximately every two seconds.
- Generates live-preview snapshots only while a preview window is active.
- Detects the shared conversation name from `<title>` and uses a sanitized form as the downloaded HTML filename.
- Preserves formula source and renders ChatGPT formulas as native **MathML**, with visible TeX fallback on conversion errors.
- Recursively captures **app block preview** iframe trees and flattens them into ordinary static HTML.
- Embeds retrievable app-block `<img>`, SVG `<image>`, CSS `background-image`, and serializable canvas content while the owning frame is still alive.
- Preserves meaningful non-formula SVG from the main conversation instead of deleting all SVG indiscriminately.
- Embeds raster references inside retained main-chat SVG when retrievable.
- Retains successful main-chat image response bytes while crawling, resolves mounted `blob:` images early, and uses late URL fetching only as a fallback.
- Sniffs image type from the actual bytes rather than blindly trusting HTTP `Content-Type`.
- Preserves captured image display dimensions and intrinsic dimensions when available.
- Preserves assistant-generated download names when visibly present; it does not infer missing filenames for user-uploaded files/images.
- Supports cancellation and cleans old completed jobs from memory.
- Includes Windows, Linux, and macOS setup/start scripts.
- Publishes finished versions as GitHub Releases with a cross-platform ZIP.

## Requirements

- Windows, Linux, or macOS
- Node.js **20 or newer**
- npm for the active Node.js installation
- Internet access while crawling the ChatGPT share URL
- A graphical desktop session when opening the interactive ChatGPT login browser
- Enough memory for Chromium plus retained HTML and embedded image data

## Downloading a release

Finished versions are published on the repository's **Releases** page. The release workflow syntax-checks the Node/inline-browser source, reads the version from `package.json`, creates the corresponding tag when that version is new, and attaches a ZIP produced from that exact commit. Versions containing a prerelease suffix such as `-beta2` are published as GitHub prereleases.

Example:

```text
chatgpt-conversation-crawler-v1.6.7-beta2.zip
```

## Quick start

### Windows

Run once:

```text
setup-windows.bat
```

Then:

```text
start-windows.bat
```

The Windows setup locates `npm.cmd` beside the active `node.exe`; the launcher starts `node server.mjs` directly.

### Linux

```bash
./setup-linux.sh
./start-linux.sh
```

If executable bits were lost during extraction:

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

The UI normally opens at:

```text
http://localhost:3000
```

By default the server binds to `127.0.0.1` so the browser-profile controls are loopback-only. `PORT` and `HOST` environment variables can override the defaults; exposing the server beyond localhost is not recommended when a saved authenticated profile exists.

## Authenticated ChatGPT browser profile

Some shared conversations expose more content to a browser that already has a valid ChatGPT session. The crawler can therefore use a dedicated persistent Chromium profile.

The profile directory is deliberately located in the same extracted project folder as the setup/start scripts:

```text
chatgpt-conversation-crawler-vX.Y.Z/
├─ setup-windows.bat
├─ start-windows.bat
├─ server.mjs
└─ browser-profile/        ← created on first login
```

`browser-profile/` is in `.gitignore` and is not included in release ZIPs.

### First login

1. Start the crawler normally.
2. Open `http://localhost:3000`.
3. Click **Open ChatGPT login**.
4. The crawler resolves Playwright's bundled Chromium executable with `chromium.executablePath()` and starts it as a normal child process using `./browser-profile` as its user-data directory.
5. Playwright does **not** connect to, inspect, script, or poll that browser while the login process is open.
6. Sign in through ChatGPT normally, including any Google/Apple/SSO/MFA/device verification that ChatGPT requests.
7. Close the login browser when sign-in is complete, or use **Close login window** in the crawler UI.
8. After the standalone Chromium process exits, the crawler briefly reopens the same profile under Playwright and probes ChatGPT's `/api/auth/session` endpoint.

The standalone login process is launched with only the dedicated user-data directory plus ordinary first-run/default-browser suppression arguments. It is not launched with a Playwright remote-debugging connection or the previous Playwright persistent-context login path.

The crawler never asks for the password and does not implement a separate credential-login protocol. Authentication happens in ChatGPT's own page.

**Beta note:** `v1.6.7-beta1` used a headed Playwright-controlled Chromium login window and can trigger Google's “browser or app may not be secure” rejection. `v1.6.7-beta2` keeps the same persistent Chromium profile design but makes the manual login browser an unmanaged standalone bundled-Chromium process. If Google still rejects the bundled Chromium distribution itself, the next fallback experiment is Firefox-based login/state transfer.

### Persistent reuse

Authenticated archive jobs still launch a Playwright persistent context backed by the same `browser-profile` directory. Cookies and browser storage therefore survive crawler/process restarts in the same way a normal browser profile does.

If ChatGPT expires, revokes, or challenges the saved session, use **Open ChatGPT login** again. **Check session** launches the saved profile briefly and probes `/api/auth/session` without deleting it. **Forget saved session** deletes `./browser-profile` entirely.

### Profile locking

Chromium does not safely support multiple processes using the same user-data directory at once. The crawler therefore gives `browser-profile` an exclusive in-process lock:

- the standalone login browser owns it while open and while the post-close session check is running;
- an authenticated archive waits while the login browser or another authenticated archive owns it;
- anonymous archives use disposable contexts and do not need the persistent-profile lock;
- session checking/deletion returns a busy error instead of racing an active owner.

If an authenticated job is queued behind the login browser, closing the login browser triggers the saved-session check and then releases the profile so the archive can continue.

### Security of the profile

Treat `browser-profile/` as credential-equivalent local state. It can contain ChatGPT cookies and other browser storage that represent an authenticated session.

Do not:

- commit it to Git;
- include it in support bundles or archive outputs;
- copy it to an untrusted machine/account;
- expose the crawler's control API to untrusted networks.

If the profile may have leaked, use ChatGPT's account security/session controls and delete the local profile.

## Traversal and progressive capture

The crawler sequence is:

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
Build static archive
```

Long ChatGPT conversations can virtualize old DOM nodes out of the document. Every encountered conversation turn is therefore retained in an in-page map keyed by its `conversation-turn-*` ID instead of waiting until the end and copying only the live DOM.

If the same turn is encountered later in a richer state, the retained copy is replaced. The turn richness score strongly favors, in order:

1. no remaining detected collapsed disclosures;
2. more `<pre>` blocks;
3. more `<code>` elements;
4. more text;
5. larger retained HTML.

Timestamp/branch markers and app-block snapshots are retained separately from the turn richness score so virtualization cannot discard them.

### Directional convergence

Each directional pass allows up to **2,000** steps. An endpoint needs six matching observations. The signature includes scroll geometry, retained/mounted turn boundaries, expansion/failure counters, `<pre>`/`<code>` counts, and timeline-marker count.

### Oldest-edge verification

The crawler repeatedly returns to the actual top (`scrollTop <= 4`) and requires twelve unchanged observations there. After several quiet checks it nudges away from the top and returns to retrigger lazy-loading/virtualizer boundaries. If the **180-check** safety limit is reached first, the archive continues but records the actual result instead of claiming false 12/12 convergence.

## Disclosure expansion

Expansion is scoped to actual conversation turns:

```css
section[data-testid^="conversation-turn-"]
```

A collapsed control is eligible when it structurally controls content (`aria-expanded="false"` with `aria-controls`) or is a recognized parent reasoning control such as **Worked for**, **Thought**, **Thinking**, or **Reasoning**. Obvious menus are excluded.

Each click is confirmed. A disclosure that remains collapsed after three attempts is recorded as a failure. The final mounted expansion sweep allows up to **500** remaining disclosures.

Complete retained-turn statistics and scroll metrics are recomputed every eight expansions and at the end of a sweep; lightweight expansion updates keep the status UI current between those full reports.

## Chat name and downloaded filename

Real shared pages expose the conversation name in the document `<title>`. The crawler rejects generic names such as `ChatGPT` and `Check out this chat` and does not use the generic Open Graph title.

The filename sanitizer:

- preserves Unicode via RFC 5987 where supported;
- removes control characters and Windows-invalid filename characters;
- trims trailing spaces/dots;
- avoids Windows reserved device names;
- caps the base-name length;
- falls back to `chatgpt-share-<job-id>.html` when no meaningful title is detected.

## Visible timestamps and branch ancestry

ChatGPT can render between-turn separators such as:

```html
<div aria-label="Today 9:09 AM" role="separator">…</div>
```

or labels such as `Monday 8:25 AM`. These are preserved **exactly as displayed**; relative labels are not converted into guessed absolute dates.

Visible **Branched from** notices and their source links are also retained. Both marker types are associated with the following conversation turn so they survive virtualization.

## Formulas and MathML

ChatGPT formula wrappers can expose authoritative TeX through `data-math-source` / `aria-label`, while the visible KaTeX subtree is often `aria-hidden="true"`. The normal sanitizer would otherwise delete the rendered formula.

Before sanitization, formula source is replaced with randomized archive tokens. Snapshot finalization uses local KaTeX with MathML-only output, `trust: false`, and bounded macro expansion. The archive retains the original TeX in `data-math-source`.

If conversion fails, the original escaped TeX is shown visibly and a diagnostic is recorded instead of leaving an empty formula.

## App block previews

ChatGPT can place generated visual content in an outer element such as:

```html
<div data-app-block-preview="true">
  <iframe ...></iframe>
</div>
```

The iframe can contain another iframe, which can contain the actual application document. The crawler does **not** use `title="App block preview"` as its primary detector. The structural anchor is `data-app-block-preview="true"`; the first descendant iframe is then followed through Playwright. The iframe title is incidental presentation metadata and may change or localize without breaking detection.

### How iframe flattening works

While the app block is mounted:

1. Playwright obtains the outer iframe's `Frame` object.
2. The frame body is cloned and a bounded set of computed layout/typography/color/SVG presentation properties is inlined.
3. Child iframes are assigned temporary randomized tokens.
4. Each child frame is recursively serialized, up to **8 frame levels**.
5. Each iframe token is replaced by the child's captured body wrapped in an ordinary static `<div class="archive-app-frame">`.
6. Scripts, stylesheets, forms, event-handler attributes and executable iframe behavior are removed.
7. The resulting flattened HTML is retained independently of ChatGPT's virtualized turn DOM.
8. During final snapshot assembly, the original `data-app-block-preview` shell in the retained turn is replaced by a randomized token before the normal conversation sanitizer runs.
9. After the normal sanitizer finishes, that token is replaced by the already-sanitized flattened app HTML.

The final archive therefore contains **no live app iframe**. Its descendants have become ordinary static HTML/SVG/image content in the main archive document.

### App-block image embedding

Assets are captured while the frame still exists rather than postponing them until after virtualization:

- ordinary `<img>` sources use `currentSrc`/`src`;
- SVG `<image href="…">` raster references are collected;
- CSS `background-image: url(...)` references from the inlined computed style are collected;
- `blob:` images are read inside the owning frame;
- HTTP(S) images are fetched through Playwright's browser-context request client;
- readable canvases are converted directly to PNG `data:` URLs.

Successful assets are replaced with `data:` URLs before the app-block snapshot is retained, making the retained block independent of short-lived sandbox URLs.

Current app-block/resource safety limits are:

- **50 app blocks**;
- **8 MiB structural HTML per captured frame/block snapshot**;
- **64 MiB total retained structural app-block HTML**;
- **32 MiB per embedded app/SVG raster asset**;
- **256 MiB total embedded app/SVG raster source bytes**;
- **8 nested frame levels**.

If an asset cannot be embedded, the original absolute URL is retained where possible and a diagnostic is recorded. Transient failures can be retried on later mounted capture checkpoints.

## SVG outside formulas and app blocks

Static SVG is handled separately before the generic sanitizer:

- SVG inside formula wrappers is left to the MathML formula path;
- SVG inside obvious buttons/UI controls is ignored;
- unlabeled `aria-hidden="true"` SVG is treated as decorative chrome and ignored;
- other SVG is tokenized before generic sanitization, sanitized with an explicit static SVG element/attribute allow-list, and restored afterward;
- raster content referenced by SVG `<image>` is embedded when retrievable;
- internal `use href="#…"` references are retained.

External SVG sprite `<use>` references are not treated as authoritative archival image data. Those references are commonly ChatGPT toolbar/icon chrome; meaningful inline chart geometry is retained directly.

## Main-conversation images

Main-chat image preservation is designed around the fact that ChatGPT frequently uses signed/ephemeral image URLs.

As soon as the browser receives a successful main-frame image response, the crawler retains its response body in a bounded in-memory cache. At full capture checkpoints it also marks mounted conversation images eager/high-priority and resolves mounted `blob:` URLs before virtualization can revoke them.

At finalization, each retained image source is resolved in this order:

1. response bytes retained during the crawl;
2. a mounted/retained `blob:` capture;
3. a same-origin browser fetch with the saved browser credentials where applicable;
4. Playwright's browser-context request client as a final HTTP fallback;
5. original URL plus a diagnostic if all embedding paths fail.

Image type is sniffed from the bytes for PNG/JPEG/WebP/GIF/BMP/ICO/AVIF/HEIC/SVG rather than blindly trusting HTTP `Content-Type`. Identical byte bodies reached through different redirect/signed-URL aliases are deduplicated.

Main-conversation image limits remain **32 MiB per image** and **256 MiB retained source bytes**. Final archive metadata reports how many images were retained during the crawl, how many required final recovery, and how many MIME declarations were corrected from the actual bytes.

## User-uploaded filenames

Shared pages can omit the original names of files/images uploaded by the user. The crawler does **not** guess missing names from runtime URLs, generated identifiers, order, or other heuristics.

Assistant-generated filenames that remain visibly present in the shared conversation are preserved as ordinary visible content.

## Live preview, heartbeat and progress

The live preview is demand-driven:

- no preview window → no preview reconstruction;
- active preview window → snapshots are normally at least 20 seconds apart;
- an unchanged material signature can defer rebuilding to 45 seconds;
- preview reconstruction is paused during oldest-edge verification.

The worker heartbeat is independent of crawler progress and updates approximately every two seconds.

`Last substantive progress` excludes ordinary scan-step churn. Retained content, mounted boundaries, timeline markers, expansion/failure state, app-block capture count/failures, and maximum observed scroll height can contribute to substantive progress.

## Static output and security model

The final HTML is script-free. It preserves semantic turn structure, code blocks, links, tables, blockquotes, formulas as MathML, timeline/branch markers, embedded images, flattened app-block contents, retained static SVG, and diagnostics.

Security constraints include:

- only HTTPS `chatgpt.com/share/...` input URLs;
- anonymous mode uses a clean disposable browser context;
- authenticated mode uses only the dedicated local `./browser-profile` chosen by the user;
- manual login occurs in the real ChatGPT page in a standalone bundled-Chromium process that Playwright does not control while sign-in is happening;
- the persistent profile is ignored by Git and never inserted into archive HTML;
- the local server binds to loopback by default;
- no copied ChatGPT scripts;
- no executable app-block iframes/scripts in the final archive;
- app-block forms and event-handler attributes removed;
- formula conversion with untrusted KaTeX features disabled.

Do not expose the local server port or `browser-profile/` to untrusted systems.

## HTTP API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/session/status` | Read persistent-profile/session state |
| `POST` | `/api/session/login` | Open the real ChatGPT site in standalone Playwright-bundled Chromium using the persistent profile |
| `POST` | `/api/session/close-login` | Close the standalone interactive login browser and verify the saved session afterward |
| `POST` | `/api/session/check` | Probe ChatGPT authentication using the saved profile |
| `POST` | `/api/session/forget` | Delete `./browser-profile` when it is not in use |
| `POST` | `/api/archive/start` | Start a tracked archive job; body accepts `sessionMode: "authenticated"` or `"anonymous"` |
| `GET` | `/api/archive/status/:id` | Poll status/progress |
| `GET` | `/api/archive/status/:id?preview=1` | Poll status and signal an active preview window |
| `GET` | `/api/archive/preview/:id` | Retrieve current preview HTML |
| `GET` | `/api/archive/download/:id` | Download final HTML |
| `POST` | `/api/archive/cancel/:id` | Cancel and close the active browser/context |

The old synchronous `POST /api/archive` endpoint is intentionally not restored.

## What the project does not do

It does not:

- bypass ChatGPT account, workspace, share-link, or authorization restrictions;
- crawl arbitrary private `/c/...` conversations—the input validator remains limited to `/share/...` URLs;
- recover content the selected anonymous/authenticated browser session never exposes;
- infer hidden timestamps;
- reconstruct filenames omitted by the shared page;
- extract private model-internal chain-of-thought;
- preserve app blocks as interactive applications;
- guarantee that an image remains available when every early/fallback embedding path and its original remote URL fail;
- guarantee that Google accepts Playwright's bundled Chromium distribution for SSO even when it is launched outside Playwright;
- guarantee compatibility with future ChatGPT DOM/auth changes without maintenance.

## Development checks

The release workflow runs syntax checks before packaging. Locally, the core checks are:

```bash
node --check server.mjs
for file in src/*.mjs; do node --check "$file"; done
bash -n setup-linux.sh start-linux.sh setup-macos.sh start-macos.sh
```

For crawler/archive changes, test at least:

1. a short anonymous conversation;
2. standalone bundled-Chromium login → close login browser → automatic saved-session verification → authenticated archive;
3. process restart → **Check session** → authenticated archive using the same `browser-profile`;
4. session expiry/logout and re-login behavior;
5. profile lock behavior while the standalone login browser or another authenticated archive owns it;
6. **Forget saved session** while idle and refusal while busy;
7. code blocks and disclosure expansion;
8. a heavily virtualized long conversation;
9. oldest-edge loading/convergence and its 180-check safety limit;
10. cancellation, including an authenticated job waiting for the profile lock;
11. preview open/closed behavior;
12. signed HTTP(S), `blob:`, lazy-loaded and MIME-mislabeled image embedding;
13. timestamp and **Branched from** markers;
14. inline/display formulas including a forced TeX-render fallback;
15. an app block with at least two iframe levels;
16. app-block `<img>`, SVG `<image>`, CSS background images and canvas where available;
17. meaningful inline SVG in the main conversation outside formula/app-block content.

## Version history

- **v1.0.0** — initial share archiver.
- **v1.1.0** — structural disclosure handling, internal scroller, progressive capture and Windows scripts.
- **v1.1.1** — Windows npm-launcher fix.
- **v1.2.0** — tracked jobs, live status/preview, cancellation and deferred download.
- **v1.3.0** — dedicated oldest-message convergence.
- **v1.3.1** — persistent Scanning / Oldest retained / Expanding plus separate Detail.
- **v1.4.0** — Linux/macOS launchers and cross-platform release ZIP.
- **v1.4.1** — clarified Detail/Scanning semantics, stale-pass fix and manual-only preview opening.
- **v1.5.0** — restored conservative v1.3 crawler safeguards, 2,000-step directional ceiling, demand-driven preview, independent heartbeat, stronger cancellation/cleanup, higher-fidelity output and embedded final images.
- **v1.5.1** — documentation reconciliation and image-fallback escaping correction.
- **v1.5.2** — truthful oldest-edge safety-limit reporting, mounted-frontier diagnostics, substantive-progress tracking, lightweight expansion reporting, randomized image tokens and `blob:` image embedding.
- **v1.5.3** — detects the shared-chat title and uses a cross-platform sanitized version as the download filename.
- **v1.6.0** — retains visible timestamp/date separators and **Branched from** ancestry markers across virtualization.
- **v1.6.1** — keeps **Expanding** coherent with the current mounted range and synchronizes lightweight boundary updates.
- **v1.6.2** — documents that shared links can omit original user-uploaded file/image names; no runtime filename inference is added.
- **v1.6.3** — preserves formula TeX before sanitization and renders formulas as native MathML with visible TeX fallback.
- **v1.6.4** — recursively captures mounted app-block iframe trees, retains static app contents across virtualization, preserves inline SVG and serializes readable canvases.
- **v1.6.5** — removes the temporary crawler/snapshot wrapper-core split, makes app-block detection structural rather than title-dependent, embeds app-block raster/background/SVG-image assets while frames are alive, and preserves meaningful non-formula SVG in the main conversation.
- **v1.6.6** — retains main-chat image response bytes during crawling, resolves mounted blobs early, corrects MIME type from actual image bytes, and uses final URL fetching only as fallback.
- **v1.6.7-beta1** — experimental persistent authenticated ChatGPT browser-profile mode using a headed Playwright-controlled Chromium login window, session checking/deletion, authenticated-job serialization, anonymous fallback mode, and loopback-only server binding by default.
- **v1.6.7-beta2** — changes only the manual-login path to launch Playwright's bundled Chromium as an unmanaged standalone OS process, keeps the same `browser-profile`, and verifies the ChatGPT session only after that browser exits.

## Maintenance note

ChatGPT's frontend and authentication flow are not stable public APIs. Prefer user-facing structural semantics—conversation-turn boundaries, accessibility disclosure state, visible timeline markers, `data-app-block-preview`, mounted-scroll behavior, and ChatGPT's own browser session endpoint—over generated CSS class names or localized presentation labels.