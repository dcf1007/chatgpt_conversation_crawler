import express from 'express';
import { chromium } from 'playwright';
import crypto from 'node:crypto';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '32kb' }));
app.use(express.static('public'));

function validateShareUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new Error('Enter a valid URL.');
  }

  if (u.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed.');
  }

  const host = u.hostname.toLowerCase();
  if (host !== 'chatgpt.com' && host !== 'www.chatgpt.com') {
    throw new Error('Only chatgpt.com share URLs are allowed.');
  }

  // Conversation shares use /share/<id>. This intentionally does not make
  // the server a general-purpose fetcher/proxy.
  if (!u.pathname.startsWith('/share/')) {
    throw new Error('Expected a ChatGPT conversation share URL under /share/.');
  }

  u.hash = '';
  return u.toString();
}

async function expandVisibleDisclosureControls(page) {
  // Open native <details> elements. This only exposes content already present
  // in the page's user-facing DOM.
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
  });

  // Expand visible disclosure-style controls. We deliberately do not inspect
  // application state, network payloads, React internals, or hidden data.
  const candidates = page.locator('button, [role="button"]');
  const count = Math.min(await candidates.count(), 250);
  const labelPattern = /\b(show more|view more|expand|thought|worked for|reasoning)\b/i;

  for (let i = 0; i < count; i++) {
    const item = candidates.nth(i);
    try {
      if (!(await item.isVisible())) continue;
      const label = await item.evaluate((el) =>
        [
          el.textContent,
          el.getAttribute('aria-label'),
          el.getAttribute('title'),
          el.getAttribute('data-testid')
        ].filter(Boolean).join(' ')
      );
      if (!labelPattern.test(label)) continue;
      await item.click({ timeout: 1000 });
      await page.waitForTimeout(80);
    } catch {
      // Controls may detach/re-render after a click; continue best-effort.
    }
  }
}

async function exhaustLazyContent(page) {
  let lastHeight = -1;
  let stableRounds = 0;

  for (let round = 0; round < 40; round++) {
    await expandVisibleDisclosureControls(page);

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.waitForTimeout(350);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    if (height === lastHeight) stableRounds += 1;
    else stableRounds = 0;
    lastHeight = height;

    if (stableRounds >= 4) break;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await expandVisibleDisclosureControls(page);
}

async function buildReadableSnapshot(page, sourceUrl) {
  return await page.evaluate(({ sourceUrl, archivedAt }) => {
    const root = document.querySelector('main') || document.body;

    // Normalize resource URLs before cloning.
    for (const img of root.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (src) img.setAttribute('data-archive-src', new URL(src, location.href).href);
    }
    for (const a of root.querySelectorAll('a[href]')) {
      try {
        a.setAttribute('data-archive-href', new URL(a.href, location.href).href);
      } catch {}
    }

    // Mark elements that are not user-visible. The archive intentionally does
    // not resurrect display:none/aria-hidden content.
    const marked = [];
    for (const el of root.querySelectorAll('*')) {
      const style = getComputedStyle(el);
      const hidden =
        el.getAttribute('aria-hidden') === 'true' ||
        el.hasAttribute('hidden') ||
        style.display === 'none' ||
        style.visibility === 'hidden';
      if (hidden) {
        el.setAttribute('data-archive-drop', '1');
        marked.push(el);
      }
    }

    const clone = root.cloneNode(true);

    // Restore original page mutations immediately.
    for (const el of marked) el.removeAttribute('data-archive-drop');
    for (const img of root.querySelectorAll('img[data-archive-src]')) {
      img.removeAttribute('data-archive-src');
    }
    for (const a of root.querySelectorAll('a[data-archive-href]')) {
      a.removeAttribute('data-archive-href');
    }

    // Remove interactive/app-only material and non-visible nodes.
    clone.querySelectorAll([
      'script', 'noscript', 'iframe', 'canvas',
      '[data-archive-drop="1"]',
      '[role="dialog"]'
    ].join(',')).forEach((el) => el.remove());

    // Point images/links at their resolved public URLs.
    for (const img of clone.querySelectorAll('img[data-archive-src]')) {
      img.src = img.getAttribute('data-archive-src');
      img.removeAttribute('srcset');
      img.removeAttribute('data-archive-src');
      img.loading = 'eager';
    }
    for (const a of clone.querySelectorAll('a[data-archive-href]')) {
      a.href = a.getAttribute('data-archive-href');
      a.removeAttribute('data-archive-href');
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }

    // Convert buttons to inert spans/divs so the result is truly static while
    // retaining their visible labels where those labels are meaningful.
    for (const button of clone.querySelectorAll('button, [role="button"]')) {
      const text = (button.textContent || '').trim();
      const aria = (button.getAttribute('aria-label') || '').trim();
      if (!text && !aria) {
        button.remove();
        continue;
      }
      const replacement = document.createElement('span');
      replacement.className = 'archived-control-label';
      replacement.textContent = text || aria;
      button.replaceWith(replacement);
    }

    // Remove app event hooks/classes that are useless outside ChatGPT while
    // preserving semantic HTML such as pre/code, lists, tables, headings, etc.
    for (const el of clone.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
        if (attr.name === 'contenteditable') el.removeAttribute(attr.name);
      }
    }

    const title = document.title || 'ChatGPT shared conversation';
    const escapedTitle = title.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ChatGPT Share Archiver">
<title>${escapedTitle}</title>
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
  background: Canvas;
  color: CanvasText;
}
.archive-shell { max-width: 980px; margin: 0 auto; padding: 28px 22px 80px; }
.archive-meta {
  border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 24px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.archive-meta strong { display: inline-block; min-width: 92px; }
main, article, section, div { max-width: 100%; }
p, li { overflow-wrap: anywhere; }
pre {
  overflow-x: auto;
  padding: 14px;
  border-radius: 10px;
  background: color-mix(in srgb, CanvasText 8%, Canvas);
  border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
  white-space: pre;
}
code, pre, kbd, samp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
:not(pre) > code {
  padding: .12em .32em;
  border-radius: 5px;
  background: color-mix(in srgb, CanvasText 8%, Canvas);
}
blockquote { margin-inline: 0; padding-left: 1em; border-left: 3px solid color-mix(in srgb, CanvasText 24%, transparent); }
table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); padding: 7px 9px; }
img, video { max-width: 100%; height: auto; }
a { color: LinkText; }
details { display: block; border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 8px; padding: 8px 10px; margin-block: 8px; }
details > summary { font-weight: 600; }
.archived-control-label { display: none !important; }
@media print { .archive-shell { max-width: none; padding: 0; } .archive-meta { break-inside: avoid; } }
</style>
</head>
<body>
<div class="archive-shell">
  <div class="archive-meta">
    <div><strong>Source</strong><a href="${sourceUrl}">${sourceUrl}</a></div>
    <div><strong>Archived</strong>${archivedAt}</div>
    <div><strong>Scope</strong>User-visible content exposed by the shared page after lazy loading and expansion.</div>
  </div>
  ${clone.outerHTML}
</div>
</body>
</html>`;
  }, { sourceUrl, archivedAt: new Date().toISOString() });
}

app.post('/api/archive', async (req, res) => {
  let browser;
  try {
    const sourceUrl = validateShareUrl(req.body?.url);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      javaScriptEnabled: true
    });
    const page = await context.newPage();

    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});

    // Basic failure/login detection. Public share pages should not require the
    // user's private session; workspace-restricted links may not be archivable.
    const bodyText = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    if (/page not found|conversation not found|link.*(expired|deleted)|access denied/i.test(bodyText)) {
      throw new Error('The shared conversation could not be accessed. The link may be invalid, deleted, or restricted.');
    }

    await exhaustLazyContent(page);
    const html = await buildReadableSnapshot(page, sourceUrl);

    const id = crypto.randomUUID().slice(0, 8);
    const filename = `chatgpt-share-${id}.html`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    res.status(400).json({ error: err?.message || 'Archive failed.' });
  } finally {
    await browser?.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`ChatGPT Share Archiver: http://localhost:${PORT}`);
});
