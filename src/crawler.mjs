export async function installCrawler(page) {
  await page.evaluate(() => {
    const state = {
      turns: Object.create(null), attempts: Object.create(null), failures: Object.create(null),
      clickCount: 0, successfulExpansions: 0
    };
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const turnId = el => el.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const label = el => [el.getAttribute('aria-label'), el.textContent, el.getAttribute('title')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    function isDisclosure(el) {
      if (!(el instanceof HTMLElement) || el.getAttribute('aria-expanded') !== 'false') return false;
      if (el.matches('[aria-haspopup], [role="menuitem"]')) return false;
      if (el.getAttribute('aria-controls')) return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(el));
    }

    const keyFor = el => [turnId(el), el.getAttribute('aria-controls') || '', label(el).slice(0, 240)].join('|');

    function scrollRoot() {
      let el = document.querySelector('#thread') || document.querySelector('main#main') || document.querySelector('main');
      while (el && el !== document.documentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 32) return el;
        el = el.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    function metrics() {
      const root = scrollRoot();
      const doc = root === document.scrollingElement || root === document.documentElement || root === document.body;
      return { top: doc ? window.scrollY : root.scrollTop, height: root.scrollHeight, client: doc ? innerHeight : root.clientHeight };
    }
    function setTop(top) {
      const root = scrollRoot();
      const doc = root === document.scrollingElement || root === document.documentElement || root === document.body;
      if (doc) window.scrollTo(0, top); else root.scrollTop = top;
    }

    function capture() {
      for (const section of turns()) {
        const id = section.getAttribute('data-testid');
        if (!id) continue;
        for (const d of section.querySelectorAll('details')) d.open = true;
        const clone = section.cloneNode(true);
        const originalImages = [...section.querySelectorAll('img')];
        const images = [...clone.querySelectorAll('img')];
        images.forEach((img, i) => {
          const src = originalImages[i]?.currentSrc || originalImages[i]?.src || img.src;
          if (src) try { img.src = new URL(src, location.href).href; } catch {}
          img.removeAttribute('srcset'); img.loading = 'eager';
        });
        const originalLinks = [...section.querySelectorAll('a[href]')];
        [...clone.querySelectorAll('a[href]')].forEach((a, i) => {
          const href = originalLinks[i]?.href || a.href;
          if (href) try { a.href = new URL(href, location.href).href; } catch {}
        });
        const remaining = [...section.querySelectorAll('[aria-expanded="false"]')].filter(isDisclosure).length + section.querySelectorAll('details:not([open])').length;
        const preCount = section.querySelectorAll('pre').length;
        const codeCount = section.querySelectorAll('code').length;
        const textLength = (section.innerText || section.textContent || '').length;
        const html = clone.outerHTML;
        const score = (remaining === 0 ? 1e9 : 0) + preCount * 1e6 + codeCount * 1e5 + textLength * 10 + Math.min(html.length, 99999);
        const previous = state.turns[id];
        if (!previous || score > previous.score || (score === previous.score && html.length > previous.html.length)) {
          state.turns[id] = { id, role: section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || '', score, preCount, codeCount, html };
        }
      }
    }

    function expandOne() {
      for (const section of turns()) {
        const d = section.querySelector('details:not([open])');
        if (d) { d.open = true; state.successfulExpansions++; return { kind: 'details' }; }
      }
      for (const section of turns()) {
        for (const el of section.querySelectorAll('[aria-expanded="false"]')) {
          if (!isDisclosure(el)) continue;
          const key = keyFor(el); const attempts = state.attempts[key] || 0;
          if (attempts >= 3) continue;
          state.attempts[key] = attempts + 1;
          try { el.scrollIntoView({ block: 'center' }); el.click(); state.clickCount++; }
          catch (e) { state.failures[key] = e?.message || 'click failed'; }
          return { kind: 'click', key };
        }
      }
      return null;
    }

    function confirm(key) {
      if (!key) return;
      const collapsed = turns().some(section => [...section.querySelectorAll('[aria-expanded="false"]')].some(el => isDisclosure(el) && keyFor(el) === key));
      if (!collapsed) { state.successfulExpansions++; delete state.failures[key]; }
      else if ((state.attempts[key] || 0) >= 3) state.failures[key] = `Could not expand after 3 attempts: ${key}`;
    }

    window.__archiveCrawler = { state, capture, expandOne, confirm, metrics, setTop };
    capture();
  });
}

async function expandMounted(page, max = 200) {
  for (let i = 0; i < max; i++) {
    const result = await page.evaluate(() => window.__archiveCrawler.expandOne());
    if (!result) break;
    await page.waitForTimeout(result.kind === 'details' ? 40 : 180);
    if (result.key) await page.evaluate(key => window.__archiveCrawler.confirm(key), result.key);
    await page.evaluate(() => window.__archiveCrawler.capture());
  }
}

async function scan(page, direction, maxSteps = 260) {
  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(top => window.__archiveCrawler.setTop(top), direction === 'down' ? 0 : Math.max(0, first.height - first.client));
  await page.waitForTimeout(250);
  let stable = 0, previous = '';
  for (let step = 0; step < maxSteps; step++) {
    await expandMounted(page);
    await page.evaluate(() => window.__archiveCrawler.capture());
    const m = await page.evaluate(() => window.__archiveCrawler.metrics());
    const maxTop = Math.max(0, m.height - m.client);
    const atEnd = direction === 'down' ? m.top >= maxTop - 4 : m.top <= 4;
    const counts = await page.evaluate(() => ({ turns: Object.keys(window.__archiveCrawler.state.turns).length, clicks: window.__archiveCrawler.state.clickCount }));
    const sig = `${Math.round(m.top)}|${m.height}|${counts.turns}|${counts.clicks}`;
    if (atEnd && sig === previous) stable++; else if (atEnd) stable = Math.max(stable, 1); else stable = 0;
    if (atEnd && stable >= 3) break;
    previous = sig;
    const stepSize = Math.max(420, Math.floor(m.client * .65));
    const next = direction === 'down' ? Math.min(maxTop, m.top + stepSize) : Math.max(0, m.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.setTop(top), next);
    await page.waitForTimeout(180);
  }
}

export async function crawlConversation(page) {
  await installCrawler(page);
  await scan(page, 'down');
  await scan(page, 'up');
  await scan(page, 'down');
  await expandMounted(page, 300);
  await page.evaluate(() => window.__archiveCrawler.capture());
}
