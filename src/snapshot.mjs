const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 256 * 1024 * 1024;
const IMAGE_CONCURRENCY = 4;

const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

async function embedImages(context, snapshot) {
  const images = snapshot.images || [];
  if (!images.length) {
    snapshot.html = snapshot.html.replace('__ARCHIVE_IMAGE_SUMMARY__', 'No images captured').replace('__ARCHIVE_IMAGE_DIAGNOSTICS__', '');
    return { ...snapshot, stats: { ...snapshot.stats, imagesTotal: 0, imagesEmbedded: 0, imageEmbeddingFailures: 0 } };
  }
  let next = 0, totalBytes = 0, embedded = 0;
  const failures = [], replacements = new Map();
  async function worker() {
    while (true) {
      const i = next++; if (i >= images.length) return;
      const { token, url } = images[i]; let replacement = esc(url);
      try {
        if (!/^https?:/i.test(url)) throw new Error('unsupported image URL scheme');
        const response = await context.request.get(url, { timeout: 20_000, failOnStatusCode: false });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith('image/')) throw new Error(`unexpected content type ${type || 'unknown'}`);
        const body = await response.body();
        if (body.length > MAX_IMAGE_BYTES) throw new Error(`image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MiB limit`);
        if (totalBytes + body.length > MAX_TOTAL_IMAGE_BYTES) throw new Error(`archive image budget exceeds ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024} MiB`);
        totalBytes += body.length; replacement = `data:${type};base64,${body.toString('base64')}`; embedded++;
      } catch (error) { failures.push(`${url} — ${error?.message || 'embedding failed'}`); }
      replacements.set(token, replacement);
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, images.length) }, () => worker()));
  for (const [token, replacement] of replacements) snapshot.html = snapshot.html.replaceAll(token, replacement);
  const diagnostic = failures.length ? `<details class="archive-diagnostics"><summary>${failures.length} image(s) could not be embedded and use their external URL instead</summary><ul>${failures.slice(0,30).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${failures.length>30?`<p>${failures.length-30} additional failure(s) omitted.</p>`:''}</details>` : '';
  snapshot.html = snapshot.html.replace('__ARCHIVE_IMAGE_SUMMARY__', `${embedded}/${images.length} embedded (${Math.round(totalBytes/1024)} KiB source bytes)`).replace('__ARCHIVE_IMAGE_DIAGNOSTICS__', diagnostic);
  return { ...snapshot, stats: { ...snapshot.stats, imagesTotal: images.length, imagesEmbedded: embedded, imageEmbeddingFailures: failures.length } };
}

export async function buildSnapshot(page, sourceUrl, { preview = false, embedImages: shouldEmbed = !preview } = {}) {
  const snapshot = await page.evaluate(({ sourceUrl, archivedAt, preview, tokenizeImages }) => {
    const archive = window.__archiveCrawler?.state; if (!archive) throw new Error('Archive state was not initialized.');
    const e=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const number=id=>Number(/conversation-turn-(\d+)/.exec(id||'')?.[1]??Number.MAX_SAFE_INTEGER), imageTokens=new Map(), images=[];
    function imageToken(url){if(imageTokens.has(url))return imageTokens.get(url);const token=`__ARCHIVE_IMAGE_${String(images.length).padStart(5,'0')}__`;imageTokens.set(url,token);images.push({token,url});return token;}
    function sanitize(capture){
      const holder=document.createElement('div');holder.innerHTML=capture.html;const section=holder.firstElementChild;if(!section)return'';
      section.querySelectorAll('script,noscript,iframe,canvas,svg,form,input,textarea,select,[hidden],[aria-hidden="true"],[role="dialog"],[role="menu"],[role="menuitem"]').forEach(el=>el.remove());
      for(const el of section.querySelectorAll('[class*="whitespace-pre-wrap"]'))el.setAttribute('data-prewrap','1');
      for(const button of [...section.querySelectorAll('button,[role="button"]')]){const text=(button.textContent||'').replace(/\s+/g,' ').trim(),aria=(button.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim(),label=text||aria;if(/^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label)){const r=document.createElement('div');r.className='archive-reasoning-label';r.textContent=label;button.replaceWith(r)}else if(text&&!/^(copy(?: code)?|copied!?|more actions|switch model)$/i.test(text)){const r=document.createElement('span');r.className='archive-inline-label';r.textContent=text;button.replaceWith(r)}else button.remove()}
      for(const el of [section,...section.querySelectorAll('*')]){const prewrap=el.hasAttribute('data-prewrap');for(const a of [...el.attributes])if(!['href','src','alt','title','dir','colspan','rowspan','width','height','data-natural-width','data-natural-height'].includes(a.name))el.removeAttribute(a.name);if(prewrap)el.classList.add('archive-prewrap')}
      for(const a of section.querySelectorAll('a[href]')){a.target='_blank';a.rel='noopener noreferrer'}
      for(const img of section.querySelectorAll('img')){img.loading='eager';const src=img.getAttribute('src')||'';if(tokenizeImages&&/^https?:/i.test(src))img.setAttribute('src',imageToken(src))}
      return section.outerHTML;
    }
    const turns=Object.values(archive.turns).sort((a,b)=>number(a.id)-number(b.id)||a.id.localeCompare(b.id));
    const rendered=turns.map(t=>{const role=t.role==='user'?'User':t.role==='assistant'?'Assistant':'Conversation';return `<article class="archive-turn archive-turn-${e(t.role||'unknown')}" data-turn="${e(t.id)}"><div class="archive-role">${e(role)}</div><div class="archive-turn-content">${sanitize(t)}</div></article>`}).join('\n');
    const failures=Object.values(archive.failures),diagnostics=failures.length?`<details class="archive-diagnostics"><summary>${failures.length} disclosure(s) could not be confirmed expanded</summary><ul>${failures.map(x=>`<li>${e(x)}</li>`).join('')}</ul></details>`:'',previewBanner=preview?'<div class="archive-preview-banner">LIVE PREVIEW — capture is still running. Images remain external here; the final archive embeds retrievable images.</div>':'';
    const imageSummary=preview?'External URLs in live preview':'__ARCHIVE_IMAGE_SUMMARY__',imageDiagnostics=preview?'':'__ARCHIVE_IMAGE_DIAGNOSTICS__';
    return {html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="ChatGPT Conversation Crawler"><title>${e(document.title||'ChatGPT shared conversation')}</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px/1.58 system-ui,sans-serif;background:Canvas;color:CanvasText}.archive-shell{max-width:1040px;margin:auto;padding:28px 22px 80px}.archive-preview-banner{position:sticky;top:0;z-index:3;margin:-28px -22px 20px;padding:10px 22px;background:CanvasText;color:Canvas;font-size:12px;font-weight:800;letter-spacing:.04em}.archive-meta{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;padding:14px 16px;margin-bottom:26px;font-size:14px;overflow-wrap:anywhere}.archive-meta strong{display:inline-block;min-width:130px}.archive-turn{padding:24px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}.archive-role{font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;opacity:.58;margin-bottom:9px}.archive-turn-content{min-width:0}.archive-prewrap{white-space:pre-wrap;overflow-wrap:anywhere}p,li{overflow-wrap:anywhere}pre{overflow-x:auto;max-width:100%;padding:14px;border-radius:10px;background:color-mix(in srgb,CanvasText 8%,Canvas);border:1px solid color-mix(in srgb,CanvasText 14%,transparent);white-space:pre}code,pre,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}:not(pre)>code{padding:.12em .32em;border-radius:5px;background:color-mix(in srgb,CanvasText 8%,Canvas)}blockquote{margin-inline:0;padding-left:1em;border-left:3px solid color-mix(in srgb,CanvasText 24%,transparent)}table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}th,td{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding:7px 9px}img,video{max-width:100%;height:auto}a{color:LinkText}.archive-reasoning-label{margin:18px 0 8px;font-weight:700;opacity:.72}.archive-inline-label{display:inline-block;margin-right:.35em}.archive-diagnostics{margin-top:22px;padding:10px 12px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:8px;overflow-wrap:anywhere}@media print{.archive-shell{max-width:none;padding:0}.archive-meta,.archive-turn{break-inside:avoid}.archive-preview-banner{display:none}}</style></head><body><div class="archive-shell">${previewBanner}<div class="archive-meta"><div><strong>Source</strong><a href="${e(sourceUrl)}">${e(sourceUrl)}</a></div><div><strong>${preview?'Previewed':'Archived'}</strong>${e(archivedAt)}</div><div><strong>Turns captured</strong>${turns.length}</div><div><strong>Expansion clicks</strong>${archive.clickCount}</div><div><strong>Confirmed expansions</strong>${archive.successfulExpansions}</div><div><strong>Images</strong>${imageSummary}</div><div><strong>Scope</strong>Content exposed by the shared page after progressive lazy loading and user-visible disclosure expansion.</div></div>${rendered||'<p>No turns captured.</p>'}${diagnostics}${imageDiagnostics}</div></body></html>`,images,stats:{turns:turns.length,clicks:archive.clickCount,expanded:archive.successfulExpansions,failures:failures.length,preBlocks:turns.reduce((n,t)=>n+(t.preCount||0),0),codeBlocks:turns.reduce((n,t)=>n+(t.codeCount||0),0)}};
  }, { sourceUrl, archivedAt: new Date().toISOString(), preview, tokenizeImages: shouldEmbed });
  if (!shouldEmbed) return snapshot;
  return embedImages(page.context(), snapshot);
}
