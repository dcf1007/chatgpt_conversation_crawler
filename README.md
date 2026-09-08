# ChatGPT Conversation Crawler

A local Node.js + Playwright utility that turns a ChatGPT **shared conversation** into a readable, script-free static HTML archive.

It is designed for long conversations where ChatGPT lazily loads history, virtualizes message turns, mounts reasoning/tool/code sections on demand, and can render generated content inside app-preview iframes.

> **Boundary:** the crawler archives content exposed to the selected share-page browser. It does not bypass account/workspace permissions or recover private model-internal chain-of-thought.

## Current release

**v1.6.7-beta11** is the regression-hardening release following the beta8–beta10 cleanup audit. See `BETA11.md` for the detailed change rationale and regression matrix.

## Architecture

Anonymous and authenticated modes use the same automatic crawler and archive builder. They differ only in browser/session setup and therefore in what ChatGPT may expose to that browser.

```text
Anonymous disposable browser ──────┐
                                   ├─> automatic crawler ─> static archive builder
Authenticated persistent profile ──┘
```

## Matched anonymous/authenticated evidence

A matched `v1.6.7-beta10-dev` diagnostic run captured the same 60-turn share once anonymously and once with the saved authenticated ChatGPT profile. Both modes used the same automatic crawler code, so the comparison is evidence about what the share page exposed to each browser rather than evidence of different crawler algorithms.

The broad conversation structure matched: both archives retained **60 turns**, **3 timeline markers**, and **180/181 formulas rendered as MathML**. The meaningful differences were resources and tool/app content exposed only to the authenticated browser.

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
| Rich tool/execution transcript | some authenticated-only tool payloads exposed | corresponding payload can be omitted |

### Uploaded images and files

The authenticated MHTML contained four directly retrievable user-uploaded images from signed `oaiusercontent.com` URLs. The exposed dimensions were one image in turn 27 at `850 × 129`, and three images in turn 37 at `360 × 500`, `2048 × 1636`, and `1286 × 700`. The anonymous view exposed textual placeholders instead of those image resources.

Neither mode recovered original upload filenames. The authenticated DOM still used generic labels such as `Uploaded image`; the two uploaded non-image files in turn 37 were exposed only as `Uploaded a file`. Filenames appearing elsewhere because the user typed them or a tool printed a local path are conversation text, not recovered attachment metadata.

### App and tool content

The authenticated page exposed an app-preview iframe plus sandbox document/CSS resources. The crawler flattened that into one static app block containing two frame levels and two SVGs. The anonymous page did not expose the corresponding sandbox resources and produced an app-preview placeholder instead.

Authentication also exposed materially richer tool/execution content in at least one assistant turn. In turn 18 the authenticated static archive retained roughly 41.8k characters, including a large visible `Analysis errored` Python/tool payload, while the anonymous archive retained roughly 3.4k characters and omitted that payload. This is user-visible share content exposed differently by ChatGPT, not private model-internal chain-of-thought recovery.

### Uploaded-image retention finding

The beta10 matched run exposed a real crawler-side gap: authenticated MHTML proved that four upload-image elements and their bytes were available to the browser, while the final static archive did not visibly retain those upload-image elements inside their user messages. The image cache could therefore report retrievable embedded sources even when the retained turn generation no longer represented them.

Beta11 directly hardens the mechanisms implicated by that finding: remounts and descendant hydration are synchronously offered to retention, media/app structure participates in retained-turn richness, and transient image DOM triggers the existing image-capture path. These changes close the identified structural loss paths, but a fresh matched live ChatGPT run is still the correct validation for the specific uploaded-image case. Beta11 does not claim to synthesize resources that ChatGPT never exposes.

### Automatic capture pipeline

```text
Pass 1 down
Pass 2 up
Oldest-edge verification
Pass 3 down
Retained-disclosure reconciliation if required
Final mounted disclosure/context flush
Static archive assembly
```

The crawler intentionally does not wait for the entire virtualized viewport to become byte-stable. Once a disclosure is activated, convergence is scoped to that turn only.

## Main features

- Accepts `https://chatgpt.com/share/...` URLs.
- Supports **Anonymous** disposable Chromium and **Authenticated** `./browser-profile` modes.
- Uses ChatGPT's actual internal conversation scroller rather than assuming window scrolling.
- Retains each observed virtualized `conversation-turn-*` section.
- Synchronously re-captures richer remounts and descendant hydration generations, then performs a short delayed settle retry.
- Replaces retained turns using a richness order that includes code, media, app blocks, disclosure state, DOM size and text.
- Expands conversation-scoped reasoning/tool disclosures, structural `aria-controls` disclosures, and native `<details>`.
- Resets a disclosure retry budget after successful activation so a later collapsed remount is eligible again.
- Uses turn-scoped nested-disclosure convergence; unrelated virtualizer churn does not reset the active turn.
- Verifies the oldest edge with bounded stable-top observations.
- Performs bounded retained-disclosure reconciliation when retained rich turns still report recognized collapsed disclosures.
- Retains visible timestamp/date separators and **Branched from** notices, including transient between-checkpoint marker generations.
- Preserves exposed message IDs and timestamp labels.
- Preserves formula source and renders formulas as native MathML with visible TeX fallback.
- Recursively captures mounted app-preview iframe trees and flattens them into static HTML.
- Retains meaningful non-formula SVG and retrievable raster resources.
- Captures main-chat image response bytes during crawling and resolves mounted blob images while the page is live.
- Preserves captured image display/intrinsic dimensions when available.
- Uses the shared conversation title for the downloaded filename after cross-platform sanitization.
- Generates live preview only while a preview window is active; the completed archive remains previewable from the final in-memory HTML.
- Keeps an independent worker heartbeat and supports cancellation.
- Includes Windows, Linux and macOS setup/start scripts.

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

The UI normally opens at `http://localhost:3000`. The server binds to `127.0.0.1` by default.

## Authenticated browser profile

The persistent profile is stored at:

```text
./browser-profile
```

Use **Open ChatGPT login** to sign in using Playwright's bundled Chromium as a standalone OS process. Authenticated archive jobs subsequently use a headed persistent Playwright context backed by the same profile; access is serialized so concurrent operations cannot race the user-data directory.

Treat `browser-profile/` as credential-equivalent local state. It is ignored by Git and never inserted into archive HTML.

Headed persistent archive/session-check contexts use:

```text
--disable-background-timer-throttling
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
```

The standalone unmanaged login browser is intentionally unaffected.

## Retention model

Two related guarantees are separate:

1. **Identity coverage:** every `conversation-turn-*` ID observed by the mount observer must have a retained candidate. A healthy completed crawl reports zero observed-but-unretained turns.
2. **Generation richness:** every remount and descendant-hydration mutation for an observed turn is synchronously offered to `captureTurn()`. Richness-aware replacement decides whether it supersedes the retained copy.

The crawler does not infer completeness from numerical turn IDs being contiguous.

### Richness ordering

For copies of the same turn, beta11 prioritizes:

1. more `<pre>`;
2. more `<code>`;
3. more media (`img`, `svg`, `canvas`, `video`);
4. more app-block roots;
5. fewer remaining recognized disclosures;
6. larger HTML;
7. more text;
8. more elements.

This ordering is specifically intended to prevent a text-heavier earlier copy from blocking a later user-visible media/app generation.

## Transient context retention

Some archival content is not safely represented by a turn clone alone. beta11 observes that context independently:

- timestamp/branch marker DOM is captured synchronously when it appears or changes;
- app-preview mutations request immediate Node-side frame-tree capture;
- transient image/blob DOM requests the existing image capture path.

Finalization drains these retainers before assembling the static archive.

## Status/API contract

`POST /api/archive/start` returns exactly:

```json
{ "id": "..." }
```

`id` is the canonical identifier in the main UI, live preview, and all archive routes. Legacy `jobId` and `?job=` aliases are not supported.

Status responses expose a stable machine-readable `stage`:

```text
queued
loading
preparing
traversal
oldest_verification
reconciliation
finalization
complete
error
cancelled
```

Human-readable `phase` and `detail` strings are presentation text only. The frontend does not parse them to infer state.

Status also includes `progressLimits`, sourced from crawler constants, so stage progress does not duplicate limits in frontend code. If those limits are unavailable, the UI falls back to an indeterminate stage display instead of silently inventing crawler constants.

## Live preview

The main UI opens:

```text
/preview.html?id=<archive-id>
```

The preview page marks itself active through status polling with `?preview=1`; preview snapshots are rebuilt only while a preview client has accessed the job recently. At completion, the final archive HTML becomes the preview snapshot.

## Static output

The final archive contains no copied ChatGPT scripts. It preserves retained semantic turn content, code, links, tables, blockquotes, MathML formulas, timeline/branch markers, retained images, flattened app-block content and static SVG.

The archive header consolidates disclosure attempts/confirmations into one **Disclosures expanded** field. If attempts differ from confirmations, retries remain visible in that field.

## Known source limitations

The crawler does **not**:

- bypass ChatGPT account, workspace, share-link or authorization restrictions;
- currently accept arbitrary private `/c/...` conversation URLs; input remains `/share/...` only;
- recover content the selected browser mode never exposes;
- recover private model-internal chain-of-thought;
- infer timestamps ChatGPT does not display;
- recover original uploaded image/file names when the share page supplies only generic upload labels;
- make anonymously unavailable uploaded-image bytes or app-sandbox resources appear through crawler logic;
- claim the beta10 uploaded-image representation case is live-validated under beta11 until a fresh matched run confirms it;
- preserve app blocks as interactive applications—the archive is static;
- guarantee recovery after every image retention/fetch path and original URL have all failed;
- guarantee that external identity providers accept Playwright Chromium under every SSO policy;
- guarantee compatibility with future ChatGPT DOM, virtualization, auth or share-page changes without maintenance.

## Security model

- HTTPS `chatgpt.com/share/...` input only;
- anonymous mode uses a disposable context;
- authenticated mode uses only the local `./browser-profile`;
- manual login occurs on the real ChatGPT site;
- browser profile is ignored by Git and never embedded in archive output;
- local server binds to loopback by default;
- final archive contains no copied ChatGPT scripts or live app iframes;
- app forms/event handlers are removed;
- KaTeX untrusted features are disabled.

## Release regression gates

The GitHub release workflow installs Node dependencies, syntax-checks Node and inline browser JavaScript, then runs every `tests/*.mjs` test before packaging a release.

Current gates include:

- turn-scoped disclosure convergence under unrelated virtualizer churn;
- successful disclosure retry reset;
- richer turn remount disappearing before the delayed settle capture;
- descendant hydration without section remount;
- observed-turn coverage;
- media-aware retained-turn replacement;
- oldest-edge verification and retained-disclosure reconciliation;
- archive fidelity metadata;
- canonical archive `id` across server/main UI/preview;
- explicit stage/progress-limit contract;
- absence of development diagnostic state in the clean runtime;
- production local-server start/status/preview/download wiring;
- clean launcher entrypoints and executable Unix launchers as retained by Git.

## Version history

- `v1.6.7-beta8-dev` — turn-scoped disclosure convergence and traversal performance recovery.
- `v1.6.7-beta9` — capture-on-mount turn-ID completeness.
- `v1.6.7-beta10-dev` — dynamic manual targets and stage-oriented UI work while development diagnostics remained enabled.
- `v1.6.7-beta10` — initial clean diagnostic-removal build; shipped stale dev launchers.
- `v1.6.7-beta10.1` — corrected clean launchers.
- `v1.6.7-beta10.2` — interim live-preview identifier compatibility hotfix.
- `v1.6.7-beta11` — canonical contracts, richer remount/hydration retention, transient-context protection, clean state boundary and integration release gates.
