export async function buildSnapshot(page, sourceUrl) {
  return page.evaluate(({ sourceUrl, archivedAt }) => {
    const archive = window.__archiveCrawler?.state;
    if (!archive) throw new Error('Archive state was not initialized.');
    const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const number = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    function sanitize(capture) {
      const holder = document.createElement('div'); holder.innerHTML = capture.html;
      const section = holder.firstElementChild; if (!section) return '';
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
        for (const a of [...el.attributes]) if (!['href','src','alt','title','dir','colspan','rowspan'].includes(a.name)) el.removeAttribute(a.name);
        if (prewrap) el.classList.add('archive-prewrap');
      }
      for (const a of section.querySelectorAll('a[href]')) { a.target='_blank'; a.rel='noopener noreferrer'; }
      for (const img of section.querySelectorAll('img')) img.loading='eager';
      return section.outerHTML;
    }
    const turns = Object.values(archive.turns).sort((a,b) => number(a.id)-number(b.id) || a.id.localeCompare(b.id));
    const rendered = turns.map(t => `<article class="archive-turn"><div class="archive-role">${esc(t.role === 'user' ? 'User' : t.role === 'assistant' ? 'Assistant' : 'Conversation')}</div>${sanitize(t)}</article>`).join('\n');
    const failures = Object.values(archive.failures);
    const diagnostics = failures.length ? `<details class="archive-diagnostics"><summary>${failures.length} disclosure(s) could not be confirmed expanded</summary><ul>${failures.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>` : '';
    return {
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(document.title || 'ChatGPT shared conversation')}</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px/1.58 system-ui,sans-serif;background:Canvas;color:CanvasText}.archive-shell{max-width:1040px;margin:auto;padding:28px 22px 80px}.archive-meta{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;padding:14px 16px;margin-bottom:26px;overflow-wrap:anywhere}.archive-meta strong{display:inline-block;min-width:112px}.archive-turn{padding:24px 0;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent)}.archive-role{font-size:12px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;opacity:.58;margin-bottom:9px}.archive-prewrap{white-space:pre-wrap;overflow-wrap:anywhere}pre{overflow-x:auto;max-width:100%;padding:14px;border-radius:10px;background:color-mix(in srgb,CanvasText 8%,Canvas);border:1px solid color-mix(in srgb,CanvasText 14%,transparent);white-space:pre}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}table{border-collapse:collapse;max-width:100%;display:block;overflow-x:auto}th,td{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding:7px 9px}img{max-width:100%;height:auto}.archive-reasoning-label{margin:18px 0 8px;font-weight:700;opacity:.72}</style></head><body><div class="archive-shell"><div class="archive-meta"><div><strong>Source</strong><a href="${esc(sourceUrl)}">${esc(sourceUrl)}</a></div><div><strong>Archived</strong>${esc(archivedAt)}</div><div><strong>Turns captured</strong>${turns.length}</div><div><strong>Expansion clicks</strong>${archive.clickCount}</div></div>${rendered || '<p>No turns captured.</p>'}${diagnostics}</div></body></html>`,
      stats: { turns: turns.length, expansions: archive.successfulExpansions, failures: failures.length, preBlocks: turns.reduce((n,t)=>n+(t.preCount||0),0) }
    };
  }, { sourceUrl, archivedAt: new Date().toISOString() });
}
