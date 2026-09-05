import crypto from 'node:crypto';
import katex from 'katex';

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const IMAGE_CONCURRENCY = 4;

const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function renderMath(snapshot) {
  const maths = snapshot.maths || [];
  if (!maths.length) {
    snapshot.html = snapshot.html
      .replace('__ARCHIVE_MATH_SUMMARY__', 'No formulas captured')
      .replace('__ARCHIVE_MATH_DIAGNOSTICS__', '');
    return {
      ...snapshot,
      stats: {
        ...snapshot.stats,
        formulasTotal: 0,
        formulasRendered: 0,
        formulaRenderFailures: 0
      }
    };
  }

  let rendered = 0;
  const failures = [];

  for (const { token, source, displayMode } of maths) {
    let replacement;
    try {
      replacement = katex.renderToString(source, {
        displayMode: Boolean(displayMode),
        output: 'mathml',
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        maxExpand: 1000
      });
      rendered++;
    } catch (error) {
      const message = error?.message || 'MathML rendering failed';
      failures.push(`${source.slice(0, 240)} — ${message}`);
      replacement = `<code class="archive-math-fallback" title="MathML rendering failed; original TeX preserved">${esc(source)}</code>`;
    }
    snapshot.html = snapshot.html.replaceAll(token, replacement);
  }

  const diagnostic = failures.length
    ? `<details class="archive-diagnostics"><summary>${failures.length} formula(s) could not be rendered as MathML; original TeX is shown instead</summary><ul>${failures.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${failures.length > 30 ? `<p>${failures.length - 30} additional failure(s) omitted.</p>` : ''}</details>`
    : '';

  snapshot.html = snapshot.html
    .replace('__ARCHIVE_MATH_SUMMARY__', `${rendered}/${maths.length} rendered as native MathML`)
    .replace('__ARCHIVE_MATH_DIAGNOSTICS__', diagnostic);

  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      formulasTotal: maths.length,
      formulasRendered: rendered,
      formulaRenderFailures: failures.length
    }
  };
}

async function embedImages(page, snapshot) {
  const images = snapshot.images || [];
  if (!images.length) {
    snapshot.html = snapshot.html
      .replace('__ARCHIVE_IMAGE_SUMMARY__', 'No images captured')
      .replace('__ARCHIVE_IMAGE_DIAGNOSTICS__', '');
    return { ...snapshot, stats: { ...snapshot.stats, imagesTotal: 0, imagesEmbedded: 0, imageEmbeddingFailures: 0 } };
  }

  let next = 0;
  let totalBytes = 0;
  let embedded = 0;
  const failures = [];
  const replacements = new Map();

  async function fetchHttp(url) {
    const response = await page.context().request.get(url, { timeout: 20_000, failOnStatusCode: false });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new Error(`unexpected content type ${type || 'unknown'}`);
    const body = await response.body();
    return { type, size: body.length, dataUrl: `data:${type};base64,${body.toString('base64')}` };
  }

  async function fetchBlob(url) {
    return page.evaluate(async ({ url, maxBytes }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`blob fetch failed (${response.status})`);
      const blob = await response.blob();
      const type = String(blob.type || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) throw new Error(`unexpected blob content type ${type || 'unknown'}`);
      if (blob.size > maxBytes) throw new Error(`image exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB limit`);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('could not read blob image'));
        reader.readAsDataURL(blob);
      });
      return { type, size: blob.size, dataUrl };
    }, { url, maxBytes: MAX_IMAGE_BYTES });
  }

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= images.length) return;
      const { token, url } = images[i];
      let replacement = esc(url);
      try {
        let image;
        if (/^https?:/i.test(url)) image = await fetchHttp(url);
        else if (/^blob:/i.test(url)) image = await fetchBlob(url);
        else throw new Error('unsupported image URL scheme');

        if (image.size > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit`);
        if (totalBytes + image.size > MAX_TOTAL_IMAGE_BYTES) throw new Error(`archive image budget exceeds ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MiB`);
        totalBytes += image.size;
        replacement = image.dataUrl;
        embedded++;
      } catch (error) {
        failures.push(`${url} — ${error?.message || 'embedding failed'}`);
      }
      replacements.set(token, replacement);
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, images.length) }, () => worker()));
  for (const [token, replacement] of replacements) snapshot.html = snapshot.html.replaceAll(token, replacement);

  const diagnostic = failures.length
    ? `<details class="archive-diagnostics"><summary>${failures.length} image(s) could not be embedded and use their original URL instead</summary><ul>${failures.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${failures.length > 30 ? `<p>${failures.length - 30} additional failure(s) omitted.</p>` : ''}</details>`
    : '';
  snapshot.html = snapshot.html
    .replace('__ARCHIVE_IMAGE_SUMMARY__', `${embedded}/${images.length} embedded (${Math.round(totalBytes / 1024)} KiB source bytes)`)
    .replace('__ARCHIVE_IMAGE_DIAGNOSTICS__', diagnostic);

  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      imagesTotal: images.length,
      imagesEmbedded: embedded,
      imageEmbeddingFailures: failures.length
    }
  };
}

export async function buildSnapshot(page, sourceUrl, { preview = false, embedImages: shouldEmbed = !preview } = {}) {
  const tokenPrefix = crypto.randomUUID().replaceAll('-', '');
  const snapshot = await page.evaluate(({ sourceUrl, archivedAt, preview, tokenizeImages, tokenPrefix }) => {
    const archive = window.__archiveCrawler?.state;
    if (!archive) throw new Error('Archive state was not initialized.');
    const escLocal = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const number = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const imageTokens = new Map();
    const images = [];
    const mathTokens = new Map();
    const maths = [];

    function imageToken(url) {
      if (imageTokens.has(url)) return imageTokens.get(url);
      const token = `__ARCHIVE_IMAGE_${tokenPrefix}_${String(images.length).padStart(5, '0')}__`;
      imageTokens.set(url, token);
      images.push({ token, url });
      return token;
    }

    function mathToken(source, displayMode) {
      const key = `${displayMode ? 'block' : 'inline'}\u0000${source}`;
      if (mathTokens.has(key)) return mathTokens.get(key);
      const token = `__ARCHIVE_MATH_${tokenPrefix}_${String(maths.length).padStart(5, '0')}__`;
      mathTokens.set(key, token);
      maths.push({ token, source, displayMode });
      return token;
    }

    function sanitize(capture) {
      const holder = document.createElement('div'); holder.innerHTML = capture.html;
      const section = holder.firstElementChild; if (!section) return '';

      for (const math of [...section.querySelectorAll('[role="math"]')]) {
        const source = (
          math.getAttribute('data-math-source')
          || math.getAttribute('aria-label')
          || math.textContent
          || ''
        ).trim();
        if (!source) continue;
        const displayMode = /(?:^|;)\s*display\s*:\s*block\b/i.test(math.getAttribute('style') || '');
        const replacement = document.createElement(displayMode ? 'div' : 'span');
        replacement.setAttribute('data-archive-math', displayMode ? 'block' : 'inline');
        replacement.setAttribute('data-math-source', source);
        replacement.textContent = mathToken(source, displayMode);
        math.replaceWith(replacement);
      }

      section.querySelectorAll('script,noscript,iframe,canvas,svg,form,input,textarea,select,[hidden],[aria-hidden="true"],[role="dialog"],[role="menu"],[role="menuitem"]').forEach(el => el.remove());
      for (const el of section.querySelectorAll('[class*="whitespace-pre-wrap"]')) el.setAttribute('data-prewrap','1');
      for (const button of [...section.querySelectorAll('button,[role="button"]')]) {
        const text = (button.textContent || '').replace(/\s+/g,' ').trim();
        const aria = (button.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
        const label = text || aria;
        if (/^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label)) {
          const r = document.createElement('div'); r.className='archive-reasoning-label'; r.textContent=label; button.replaceWith(r);
        } else if (text && !/^(copy(?: code)?|copied!?|more actions|switch model)$/i.test(text)) {
          const r = document.createElement('span'); r.className='archive-inline-label'; r.textContent=text; button.replaceWith(r);
        } else button.remove();
      }
      for (const el of [section, ...section.querySelectorAll('*')]) {
        const prewrap = el.hasAttribute('data-prewrap');
        for (const a of [...el.attributes]) {
          if (!['href','src','alt','title','dir','colspan','rowspan','width','height','data-natural-width','data-natural-height','data-archive-math','data-math-source'].includes(a.name)) el.removeAttribute(a.name);
        }
        if (prewrap) el.classList.add('archive-prewrap');
      }
      for (const a of section.querySelectorAll('a[href]')) { a.target='_blank'; a.rel='noopener noreferrer'; }
      for (const img of section.querySelectorAll('img')) {
        img.loading='eager';
        const src = img.getAttribute('src') || '';
        if (tokenizeImages && /^(https?:|blob:)/i.test(src)) img.setAttribute('src', imageToken(src));
      }
      return section.outerHTML;
    }

    const turns = Object.values(archive.turns).sort((a,b) => number(a.id)-number(b.id) || a.id.localeCompare(b.id));
    const markers = Object.values(archive.timelineMarkers || {}).sort((a, b) =>
      number(a.beforeTurn) - number(b.beforeTurn)
      || Number(a.order || 0) - Number(b.order || 0)
      || String(a.kind || '').localeCompare(String(b.kind || ''))
      || String(a.text || '').localeCompare(String(b.text || ''))
    );
    const markersByTurn = new Map();
    for (const marker of markers) {
      if (!markersByTurn.has(marker.beforeTurn)) markersByTurn.set(marker.beforeTurn, []);
      markersByTurn.get(marker.beforeTurn).push(marker);
    }

    function renderMarker(marker) {
      if (marker.kind === 'timestamp') {
        return `<div class="archive-timeline-marker archive-timestamp" role="separator" aria-label="${escLocal(marker.text || marker.label || '')}"><span>${escLocal(marker.text || marker.label || '')}</span></div>`;
      }
      if (marker.kind === 'branch') {
        const title = marker.title || String(marker.text || '').replace(/^Branched from\s*/i, '') || 'previous conversation';
        const linked = marker.href
          ? `<a href="${escLocal(marker.href)}" target="_blank" rel="noopener noreferrer">${escLocal(title)}</a>`
          : escLocal(title);
        return `<div class="archive-timeline-marker archive-branch-marker"><span>Branched from ${linked}</span></div>`;
      }
      return `<div class="archive-timeline-marker">${escLocal(marker.text || marker.label || '')}</div>`;
    }

    const rendered = turns.map(t => {
      const role = t.role === 'user' ? 'User' : t.role === 'assistant' ? 'Assistant' : 'Conversation';
      const before = (markersByTurn.get(t.id) || []).map(renderMarker).join('\n');
      const timestamp = (markersByTurn.get(t.id) || []).find(marker => marker.kind === 'timestamp')?.text || t.timestampLabel || '';
      const messageIdAttr = t.messageId ? ` data-message-id="${escLocal(t.messageId)}"` : '';
      const timestampAttr = timestamp ? ` data-timestamp-label="${escLocal(timestamp)}"` : '';
      return `${before}<article class="archive-turn archive-turn-${escLocal(t.role || 'unknown')}" data-turn="${escLocal(t.id)}"${messageIdAttr}${timestampAttr}><div class="archive-role">${escLocal(role)}</div><div class="archive-turn-content">${sanitize(t)}</div></article>`;
    }).join('\n');
    const failures = Object.values(archive.failures);
    const diagnostics = failures.length ? `<details class="archive-diagnostics"><summary>${failures.length} disclosure(s) could not be confirmed expanded</summary><ul>${failures.map(x=>`<li>${escLocal(x)}</li>`).join('')}</ul></details>` : '';
    const oldest = archive.oldestVerification || {};
    const oldestDiagnostic = !preview && oldest.converged === false
      ? `<details class="archive-diagnostics archive-warning" open><summary>Oldest-message verification reached its safety limit</summary><p>The crawler continued after ${Number(oldest.checks || 0)} checks with ${Number(oldest.quietChecks || 0)}/${Number(oldest.requiredQuietChecks || 12)} consecutive quiet top observations. The archive may still be complete, but the oldest edge was not proven converged.</p></details>`
      : '';
    const previewBanner = preview ? '<div class="archive-preview-banner">LIVE PREVIEW — capture is still running. Images remain external here; the final archive embeds retrievable images.</div>' : '';
    const imageSummary = preview ? 'External URLs in live preview' : '__ARCHIVE_IMAGE_SUMMARY__';
    const imageDiagnostics = preview ? '' : '__ARCHIVE_IMAGE_DIAGNOSTICS__';
    const mathSummary = '__ARCHIVE_MATH_SUMMARY__';
    const mathDiagnostics = '__ARCHIVE_MATH_DIAGNOSTICS__';

    return {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="ChatGPT Conversation Crawler"><title>${escLocal(document.title || 'ChatGPT shared conversation')}</title><style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px/1.58 system-ui,sans-serif;background:Canvas;color:CanvasText}.archive-shell{max-width:1040px;margin:auto;padding:28px 22px 80px}.archive-preview-banner{position:sticky;top:0;z-index:3;margin:-28px -22px 20px;padding:10px 22px;background:CanvasText;color:Canvas;font-size:12px;font-weight:800;letter-spacing:.04em}.archive-meta{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;padding:14px 16px;margin-bottom:26px;font-size:14px;overflow-wrap:anywhere}.archive-meta strong{display:inline-block;min-width:130px}.archive-timeline-marker{margin:22px 0 2px;display:flex;align-items:center;justify-content:center;gap:10px;color:color-mix(in srgb,CanvasText 58%,transparent);font-size:13px;text-align:center}.archive-timeline-marker::before,.archive-timeline-marker::after{content:"";height:1px;flex:1;background:color-mix(in srgb,CanvasText 16%,transparent)}.archive-timestamp span{white-space:nowrap;font-weight:600}.archive-branch-marker span{white-space:normal}.archive-branch-marker a{font-weight:700}.archive-turn{padding:24px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}.archive-role{font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;opacity:.58;margin-bottom:9px}.archive-turn-content{min-width:0}.archive-prewrap{white-space:pre-wrap;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}pre{overflow-x:auto;max-width:100%;padding:14px;border-radius:10px;background:color-mix(in srgb,CanvasText 8%,Canvas);border:1px solid color-mix(in srgb,CanvasText 14%,transparent);white-space:pre}code,pre,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}:not(pre)>code{padding:.12em .32em;border-radius:5px;background:color-mix(in srgb,CanvasText 8%,Canvas)}blockquote{margin-inline:0;padding-left:1em;border-left:3px solid color-mix(in srgb,CanvasText 24%,transparent)}table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}th,td{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding:7px 9px}img,video{max-width:100%;height:auto}a{color:LinkText}[data-archive-math="inline"]{display:inline-block;max-width:100%;vertical-align:middle}[data-archive-math="block"]{display:block;max-width:100%;overflow-x:auto;overflow-y:hidden;text-align:center;margin:.9em 0;padding:.15em 0}[data-archive-math] math{font-family:math,"Cambria Math","STIX Two Math",serif}.archive-math-fallback{white-space:pre-wrap;overflow-wrap:anywhere}.archive-reasoning-label{margin:18px 0 8px;font-weight:700;opacity:.72}.archive-inline-label{display:inline-block;margin-right:.35em}.archive-diagnostics{margin-top:22px;padding:10px 12px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:8px;overflow-wrap:anywhere}.archive-warning{border-color:#b77;background:color-mix(in srgb,#b77 10%,Canvas)}@media print{.archive-shell{max-width:none;padding:0}.archive-meta,.archive-turn{break-inside:avoid}.archive-preview-banner{display:none}}</style></head><body><div class="archive-shell">${previewBanner}<div class="archive-meta"><div><strong>Source</strong><a href="${escLocal(sourceUrl)}">${escLocal(sourceUrl)}</a></div><div><strong>${preview ? 'Previewed' : 'Archived'}</strong>${escLocal(archivedAt)}</div><div><strong>Turns captured</strong>${turns.length}</div><div><strong>Timeline markers</strong>${markers.length}</div><div><strong>Expansion clicks</strong>${archive.clickCount}</div><div><strong>Confirmed expansions</strong>${archive.successfulExpansions}</div><div><strong>Formulas</strong>${mathSummary}</div><div><strong>Images</strong>${imageSummary}</div><div><strong>Scope</strong>Content exposed by the shared page after progressive lazy loading and user-visible disclosure expansion. Timestamp labels and formula source are preserved when ChatGPT exposes them.</div></div>${rendered || '<p>No turns captured.</p>'}${diagnostics}${oldestDiagnostic}${mathDiagnostics}${imageDiagnostics}</div></body></html>`,
      images,
      maths,
      stats: {
        turns: turns.length,
        timelineMarkers: markers.length,
        clicks: archive.clickCount,
        expanded: archive.successfulExpansions,
        failures: failures.length,
        preBlocks: turns.reduce((n,t)=>n+(t.preCount||0),0),
        codeBlocks: turns.reduce((n,t)=>n+(t.codeCount||0),0)
      }
    };
  }, { sourceUrl, archivedAt: new Date().toISOString(), preview, tokenizeImages: shouldEmbed, tokenPrefix });

  const withMath = renderMath(snapshot);
  if (!shouldEmbed) return withMath;
  return embedImages(page, withMath);
}
