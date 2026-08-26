export async function installCrawler(page) {
  await page.evaluate(() => {
    const state = {
      turns: Object.create(null),
      attempts: Object.create(null),
      failures: Object.create(null),
      clickCount: 0,
      successfulExpansions: 0,
      lastExpansion: 'No disclosure expansion yet'
    };

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const turnId = el => el.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const label = el => [el.getAttribute('aria-label'), el.textContent, el.getAttribute('title')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);

    function isDisclosure(el) {
      if (!(el instanceof HTMLElement) || el.getAttribute('aria-expanded') !== 'false') return false;
      if (el.matches('[aria-haspopup],[role="menuitem"]')) return false;
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
      return {
        top: doc ? scrollY : root.scrollTop,
        height: root.scrollHeight,
        client: doc ? innerHeight : root.clientHeight
      };
    }

    function setTop(top) {
      const root = scrollRoot();
      const doc = root === document.scrollingElement || root === document.documentElement || root === document.body;
      if (doc) scrollTo(0, top); else root.scrollTop = top;
    }

    function retainedIds() {
      return Object.keys(state.turns).sort((a, b) => turnNumber(a) - turnNumber(b) || a.localeCompare(b));
    }

    function capture() {
      for (const section of turns()) {
        const id = section.getAttribute('data-testid');
        if (!id) continue;

        for (const d of section.querySelectorAll('details')) d.open = true;
        const clone = section.cloneNode(true);

        const originalImages = [...section.querySelectorAll('img')];
        [...clone.querySelectorAll('img')].forEach((img, i) => {
          const src = originalImages[i]?.currentSrc || originalImages[i]?.src || img.src;
          if (src) try { img.src = new URL(src, location.href).href; } catch {}
          img.removeAttribute('srcset');
          img.loading = 'eager';
        });

        const originalLinks = [...section.querySelectorAll('a[href]')];
        [...clone.querySelectorAll('a[href]')].forEach((a, i) => {
          const href = originalLinks[i]?.href || a.href;
          if (href) try { a.href = new URL(href, location.href).href; } catch {}
        });

        const remaining = [...section.querySelectorAll('[aria-expanded="false"]')].filter(isDisclosure).length
          + section.querySelectorAll('details:not([open])').length;
        const preCount = section.querySelectorAll('pre').length;
        const codeCount = section.querySelectorAll('code').length;
        const textLength = (section.innerText || section.textContent || '').length;
        const html = clone.outerHTML;
        const score = (remaining === 0 ? 1e9 : 0)
          + preCount * 1e6
          + codeCount * 1e5
          + textLength * 10
          + Math.min(html.length, 99999);
        const previous = state.turns[id];

        if (!previous || score > previous.score || (score === previous.score && html.length > previous.html.length)) {
          state.turns[id] = {
            id,
            role: section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || '',
            score,
            preCount,
            codeCount,
            html
          };
        }
      }
    }

    function expandOne() {
      for (const section of turns()) {
        const details = section.querySelector('details:not([open])');
        if (details) {
          details.open = true;
          state.successfulExpansions++;
          state.lastExpansion = `${turnId(details)} — opened native <details>`;
          return { kind: 'details', description: state.lastExpansion };
        }
      }

      for (const section of turns()) {
        for (const el of section.querySelectorAll('[aria-expanded="false"]')) {
          if (!isDisclosure(el)) continue;
          const key = keyFor(el);
          const attempts = state.attempts[key] || 0;
          if (attempts >= 3) continue;
          state.attempts[key] = attempts + 1;
          const shortLabel = label(el).slice(0, 180) || el.getAttribute('aria-controls') || 'unlabelled disclosure';
          state.lastExpansion = `${turnId(el)} — ${shortLabel}`;
          try {
            el.scrollIntoView({ block: 'center' });
            el.click();
            state.clickCount++;
          } catch (error) {
            state.failures[key] = error?.message || 'click failed';
          }
          return { kind: 'click', key, description: state.lastExpansion };
        }
      }
      return null;
    }

    function confirm(key) {
      if (!key) return;
      const collapsed = turns().some(section =>
        [...section.querySelectorAll('[aria-expanded="false"]')]
          .some(el => isDisclosure(el) && keyFor(el) === key)
      );
      if (!collapsed) {
        state.successfulExpansions++;
        delete state.failures[key];
      } else if ((state.attempts[key] || 0) >= 3) {
        state.failures[key] = `Could not expand after 3 attempts: ${key}`;
      }
    }

    function stats() {
      const values = Object.values(state.turns);
      const ids = retainedIds();
      return {
        turns: values.length,
        expanded: state.successfulExpansions,
        clicks: state.clickCount,
        failures: Object.keys(state.failures).length,
        preBlocks: values.reduce((n, turn) => n + (turn.preCount || 0), 0),
        codeBlocks: values.reduce((n, turn) => n + (turn.codeCount || 0), 0),
        oldestRetained: ids[0] || 'none',
        expandingStatus: state.lastExpansion
      };
    }

    function topSignature() {
      const ids = retainedIds();
      const mounted = turns();
      const s = stats();
      const m = metrics();
      return {
        oldestRetained: ids[0] || 'none',
        mountedFirst: mounted[0]?.getAttribute('data-testid') || 'none',
        turns: s.turns,
        height: m.height,
        preBlocks: s.preBlocks,
        codeBlocks: s.codeBlocks,
        clicks: s.clicks,
        expanded: s.expanded
      };
    }

    window.__archiveCrawler = { state, capture, expandOne, confirm, metrics, setTop, stats, topSignature };
    capture();
  });
}

async function report(page, onProgress, extra = {}) {
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  await onProgress?.({
    ...stats,
    scrollTop: metrics.top,
    scrollHeight: metrics.height,
    scrollClient: metrics.client,
    ...extra
  });
}

async function expandMounted(page, max, onProgress, shouldCancel) {
  for (let i = 0; i < max; i++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const result = await page.evaluate(() => window.__archiveCrawler.expandOne());
    if (!result) break;
    await page.waitForTimeout(result.kind === 'details' ? 40 : 180);
    if (result.key) await page.evaluate(key => window.__archiveCrawler.confirm(key), result.key);
    await page.evaluate(() => window.__archiveCrawler.capture());
    if (i % 8 === 0) {
      await report(page, onProgress, {
        detail: `Expanding mounted disclosures (${i + 1})`,
        expandingStatus: result.description || `Expansion ${i + 1}`
      });
    }
  }
}

async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = 1200) {
  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(
    top => window.__archiveCrawler.setTop(top),
    direction === 'down' ? 0 : Math.max(0, first.height - first.client)
  );
  await page.waitForTimeout(300);

  let stable = 0;
  let previous = '';

  for (let step = 0; step < maxSteps; step++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    await expandMounted(page, 180, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const maxTop = Math.max(0, metrics.height - metrics.client);
    const atEnd = direction === 'down' ? metrics.top >= maxTop - 4 : metrics.top <= 4;
    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const signature = `${Math.round(metrics.top)}|${metrics.height}|${stats.turns}|${stats.clicks}`;
    const scanningStatus = `Pass ${pass}/3 — ${direction} · step ${step + 1}`;

    await onProgress?.({
      ...stats,
      phase: 'Scanning conversation',
      detail: `Pass ${pass}/3 — ${direction}`,
      scanningStatus,
      pass,
      direction,
      step: step + 1,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && signature === previous) stable++;
    else if (atEnd) stable = Math.max(stable, 1);
    else stable = 0;
    if (atEnd && stable >= 3) break;
    previous = signature;

    const stepRatio = direction === 'up' ? 0.42 : 0.65;
    const minimumStep = direction === 'up' ? 280 : 420;
    const stepSize = Math.max(minimumStep, Math.floor(metrics.client * stepRatio));
    const next = direction === 'down'
      ? Math.min(maxTop, metrics.top + stepSize)
      : Math.max(0, metrics.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.setTop(top), next);
    await page.waitForTimeout(direction === 'up' ? 220 : 180);
  }
}

async function verifyOldestMessages(page, onProgress, shouldCancel) {
  const requiredQuietChecks = 12;
  const maxChecks = 180;
  let quietChecks = 0;
  let previousSignature = '';

  await onProgress?.({
    phase: 'Verifying oldest messages',
    detail: 'Pausing preview reconstruction while checking for asynchronously prepended turns',
    scanningStatus: 'Top-edge convergence probe',
    pass: 2,
    direction: 'up',
    previewPaused: true
  });

  for (let check = 0; check < maxChecks; check++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');

    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(520);
    await expandMounted(page, 220, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const top = await page.evaluate(() => window.__archiveCrawler.topSignature());
    const signature = [
      top.oldestRetained,
      top.mountedFirst,
      top.turns,
      top.height,
      top.preBlocks,
      top.codeBlocks,
      top.clicks,
      top.expanded
    ].join('|');

    if (signature === previousSignature) quietChecks++;
    else quietChecks = 0;
    previousSignature = signature;

    await report(page, onProgress, {
      phase: 'Verifying oldest messages',
      detail: `Mounted first: ${top.mountedFirst} · ${quietChecks}/${requiredQuietChecks} quiet top checks`,
      scanningStatus: `Top-edge verification · check ${check + 1} · ${quietChecks}/${requiredQuietChecks} quiet`,
      oldestRetained: top.oldestRetained,
      pass: 2,
      direction: 'up',
      step: check + 1,
      previewPaused: true
    });

    if (quietChecks >= requiredQuietChecks) break;

    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const maxTop = Math.max(0, metrics.height - metrics.client);
    const nudge = Math.min(maxTop, Math.max(96, Math.floor(metrics.client * 0.16)));
    await page.evaluate(top => window.__archiveCrawler.setTop(top), nudge);
    await page.waitForTimeout(120);
    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(520);
  }

  await report(page, onProgress, {
    phase: 'Oldest-message verification complete',
    detail: 'Top-region capture converged; resuming the final downward pass',
    scanningStatus: 'Top-edge convergence complete',
    pass: 2,
    direction: 'up',
    previewPaused: false
  });
}

export async function crawlConversation(page, { onProgress, shouldCancel } = {}) {
  await installCrawler(page);
  await report(page, onProgress, {
    phase: 'Preparing crawler',
    detail: 'Installed page-side capture helpers',
    scanningStatus: 'Preparing first downward scan',
    previewPaused: false
  });

  await scan(page, 'down', 1, onProgress, shouldCancel);
  await scan(page, 'up', 2, onProgress, shouldCancel);
  await verifyOldestMessages(page, onProgress, shouldCancel);
  await scan(page, 'down', 3, onProgress, shouldCancel);

  await onProgress?.({
    phase: 'Final expansion sweep',
    detail: 'Opening remaining mounted disclosures',
    scanningStatus: 'Three scan passes complete',
    previewPaused: false
  });
  await expandMounted(page, 400, onProgress, shouldCancel);
  await page.evaluate(() => window.__archiveCrawler.capture());
  await report(page, onProgress, {
    phase: 'Final expansion sweep',
    detail: 'Capture stabilized',
    scanningStatus: 'Scanning complete',
    previewPaused: false
  });
}
