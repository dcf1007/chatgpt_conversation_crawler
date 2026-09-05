import crypto from 'node:crypto';
import { captureMountedAppBlocks, getCapturedAppBlocks } from './app-blocks.mjs';
import { buildSnapshot as buildSnapshotCore } from './snapshot-core.mjs';

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

const APP_BLOCK_CSS = `
.archive-app-block{margin:18px 0;padding:12px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:12px;overflow:auto;background:color-mix(in srgb,CanvasText 2%,Canvas)}
.archive-app-block-label{margin:0 0 10px;font-size:12px;font-weight:750;letter-spacing:.05em;text-transform:uppercase;opacity:.58}
.archive-app-block-content{position:relative;min-width:0;max-width:100%;overflow:auto;isolation:isolate}
.archive-app-block-content img,.archive-app-block-content svg{max-width:100%;height:auto}
.archive-app-frame{position:relative;min-width:0;max-width:100%;overflow:auto}
.archive-app-frame-missing,.archive-app-block-fallback{padding:10px;border:1px dashed color-mix(in srgb,CanvasText 20%,transparent);border-radius:8px;opacity:.7}
`;

function blockMarkup(block) {
  return `<section class="archive-app-block" data-app-block-source="${esc(block.sourceUrl)}"><div class="archive-app-block-label">App block preview</div><div class="archive-app-block-content">${block.html}</div></section>`;
}

function injectAppCss(html) {
  if (html.includes('.archive-app-block{')) return html;
  return html.replace('</style>', `${APP_BLOCK_CSS}</style>`);
}

function injectAppDiagnostics(html, messages) {
  if (!messages.length) return html;
  const diagnostic = `<details class="archive-diagnostics"><summary>${messages.length} app-block preview issue(s)</summary><ul>${messages.slice(0, 30).map(message => `<li>${esc(message)}</li>`).join('')}</ul>${messages.length > 30 ? `<p>${messages.length - 30} additional issue(s) omitted.</p>` : ''}</details>`;
  return html.replace('</div></body></html>', `${diagnostic}</div></body></html>`);
}

export async function buildSnapshot(page, sourceUrl, options = {}) {
  await captureMountedAppBlocks(page).catch(() => {});
  const retainedApps = getCapturedAppBlocks(page);
  const prefix = crypto.randomUUID().replaceAll('-', '');
  const blockMap = new Map(retainedApps.blocks.map(block => [block.sourceUrl, block]));
  const sourceTokens = Object.fromEntries(
    retainedApps.blocks.map((block, index) => [
      block.sourceUrl,
      `__ARCHIVE_APP_BLOCK_${prefix}_${String(index).padStart(5, '0')}__`
    ])
  );

  const rewrite = await page.evaluate(({ sourceTokens }) => {
    const turns = window.__archiveCrawler?.state?.turns;
    if (!turns) return { originals: [], used: [], missing: [] };

    const originals = [];
    const used = [];
    const missing = [];

    for (const turn of Object.values(turns)) {
      if (!turn?.id || !turn?.html || !turn.html.includes('data-app-block-preview')) continue;

      const holder = document.createElement('div');
      holder.innerHTML = turn.html;
      const roots = [...holder.querySelectorAll('[data-app-block-preview="true"]')];
      if (!roots.length) continue;

      let changed = false;
      for (const root of roots) {
        const iframe = root.querySelector('iframe[title="App block preview"],iframe');
        const raw = iframe?.getAttribute('src') || '';
        let source = raw;
        try { source = raw ? new URL(raw, location.href).href : ''; } catch {}

        const token = sourceTokens[source];
        if (token) {
          const placeholder = document.createElement('span');
          placeholder.textContent = token;
          root.replaceWith(placeholder);
          used.push(source);
        } else {
          const fallback = document.createElement('div');
          fallback.className = 'archive-app-block-fallback';
          const label = document.createElement('strong');
          label.textContent = 'App block preview could not be captured';
          fallback.append(label);
          if (source) {
            fallback.append(document.createTextNode(' — '));
            const link = document.createElement('a');
            link.href = source;
            link.textContent = source;
            fallback.append(link);
          }
          root.replaceWith(fallback);
          missing.push(source || 'unknown app-block source');
        }
        changed = true;
      }

      if (changed) {
        originals.push({ id: turn.id, html: turn.html });
        turn.html = holder.innerHTML;
      }
    }

    return { originals, used, missing };
  }, { sourceTokens });

  let snapshot;
  try {
    snapshot = await buildSnapshotCore(page, sourceUrl, options);
  } finally {
    if (rewrite.originals.length) {
      await page.evaluate(originals => {
        const turns = window.__archiveCrawler?.state?.turns;
        if (!turns) return;
        for (const original of originals) {
          if (turns[original.id]) turns[original.id].html = original.html;
        }
      }, rewrite.originals).catch(() => {});
    }
  }

  const usedBlocks = [];
  for (const source of rewrite.used) {
    const token = sourceTokens[source];
    const block = blockMap.get(source);
    if (!token || !block) continue;
    snapshot.html = snapshot.html.replaceAll(token, blockMarkup(block));
    usedBlocks.push(block);
  }

  const uniqueBlocks = [...new Map(usedBlocks.map(block => [block.sourceUrl, block])).values()];
  const renderedCount = rewrite.used.length;
  const frameCount = uniqueBlocks.reduce((sum, block) => sum + (block.frameCount || 0), 0);
  const svgCount = uniqueBlocks.reduce((sum, block) => sum + (block.svgCount || 0), 0);
  const imageCount = uniqueBlocks.reduce((sum, block) => sum + (block.imageCount || 0), 0);
  const canvasCount = uniqueBlocks.reduce((sum, block) => sum + (block.canvasCount || 0), 0);

  snapshot.html = injectAppCss(snapshot.html);
  snapshot.html = snapshot.html.replace(
    '<div><strong>Expansion clicks</strong>',
    `<div><strong>App blocks</strong>${renderedCount} rendered (${uniqueBlocks.length} unique; ${frameCount} frame${frameCount === 1 ? '' : 's'}; ${svgCount} SVG${svgCount === 1 ? '' : 's'})</div><div><strong>Expansion clicks</strong>`
  );

  const issues = [
    ...rewrite.missing.map(source => `No retained app-block snapshot matched ${source}.`),
    ...retainedApps.failures.map(item => `${item.sourceUrl}: ${item.message}`)
  ];
  snapshot.html = injectAppDiagnostics(snapshot.html, [...new Set(issues)]);

  snapshot.stats = {
    ...snapshot.stats,
    appBlocksRendered: renderedCount,
    appBlocksCaptured: uniqueBlocks.length,
    appBlockFrames: frameCount,
    appBlockSvgs: svgCount,
    appBlockImages: imageCount,
    appBlockCanvases: canvasCount,
    appBlockCaptureFailures: issues.length
  };

  return snapshot;
}
