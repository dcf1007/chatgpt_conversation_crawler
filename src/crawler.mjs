export async function installCrawler(page) {
  await page.evaluate(() => {
    const state = {
      turns: Object.create(null),
      timelineMarkers: Object.create(null),
      attempts: Object.create(null),
      failures: Object.create(null),
      clickCount: 0,
      successfulExpansions: 0,
      lastExpansion: 'No disclosure expansion yet',
      oldestVerification: { converged: null, quietChecks: 0, checks: 0, requiredQuietChecks: 12, maxChecks: 180 }
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

    function mountedIds() {
      return turns().map(section => section.getAttribute('data-testid')).filter(Boolean)
        .sort((a, b) => turnNumber(a) - turnNumber(b) || a.localeCompare(b));
    }

    function nextTurnAfter(element, mountedTurns) {
      for (const section of mountedTurns) {
        if (element === section || section.contains(element)) continue;
        if (element.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING) return section;
      }
      return null;
    }

    function captureTimelineMarkers() {
      const mountedTurns = turns();
      const candidates = [];

      for (const separator of document.querySelectorAll('main [role="separator"][aria-label]')) {
        if (separator.closest(turnSelector)) continue;
        const text = (separator.getAttribute('aria-label') || separator.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        candidates.push({ element: separator, kind: 'timestamp', label: text, text, href: '' });
      }

      for (const anchor of document.querySelectorAll('main p a[href*="/c/"]')) {
        const paragraph = anchor.closest('p');
        if (!paragraph || paragraph.closest(turnSelector)) continue;
        const text = (paragraph.textContent || '').replace(/\s+/g, ' ').trim();
        if (!/^Branched from\b/i.test(text)) continue;
        let href = '';
        if (anchor?.href) {
          try { href = new URL(anchor.href, location.href).href; } catch { href = anchor.href; }
        }
        const title = (anchor?.textContent || text.replace(/^Branched from\s*/i, '')).replace(/\s+/g, ' ').trim();
        candidates.push({
          element: paragraph,
          kind: 'branch',
          label: 'Branched from',
          text: title ? `Branched from ${title}` : text,
          href,
          title
        });
      }

      candidates.sort((a, b) => {
        if (a.element === b.element) return 0;
        return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      const orderByTurn = Object.create(null);
      for (const candidate of candidates) {
        const nextTurn = nextTurnAfter(candidate.element, mountedTurns);
        const beforeTurn = nextTurn?.getAttribute('data-testid');
        if (!beforeTurn) continue;
        const order = orderByTurn[beforeTurn] || 0;
        orderByTurn[beforeTurn] = order + 1;
        const key = [beforeTurn, candidate.kind, candidate.text, candidate.href].join('|');
        state.timelineMarkers[key] = {
          key,
          beforeTurn,
          kind: candidate.kind,
          label: candidate.label,
          text: candidate.text,
          href: candidate.href,
          title: candidate.title || '',
          order
        };
      }
    }

    function capture() {
      captureTimelineMarkers();
      for (const section of turns()) {
        const id = section.getAttribute('data-testid');
        if (!id) continue;

        for (const d of section.querySelectorAll('details')) d.open = true;
        const clone = section.cloneNode(true);

        const originalImages = [...section.querySelectorAll('img')];
        [...clone.querySelectorAll('img')].forEach((img, i) => {
          const original = originalImages[i];
          const src = original?.currentSrc || original?.src || img.src;
          if (src) try { img.src = new URL(src, location.href).href; } catch {}
          img.removeAttribute('srcset');
          img.loading = 'eager';

          if (original) {
            const rect = original.getBoundingClientRect();
            const naturalWidth = Number(original.naturalWidth || 0);
            const naturalHeight = Number(original.naturalHeight || 0);
            const displayWidth = Math.round(rect.width || 0) || Number(original.getAttribute('width') || 0) || naturalWidth;
            const displayHeight = Math.round(rect.height || 0) || Number(original.getAttribute('height') || 0) || naturalHeight;
            if (displayWidth > 0) img.setAttribute('width', String(displayWidth));
            if (displayHeight > 0) img.setAttribute('height', String(displayHeight));
            if (naturalWidth > 0) img.setAttribute('data-natural-width', String(naturalWidth));
            if (naturalHeight > 0) img.setAttribute('data-natural-height', String(naturalHeight));
          }
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
          const message = section.querySelector('[data-message-id]');
          const timestamp = Object.values(state.timelineMarkers)
            .filter(marker => marker.beforeTurn === id && marker.kind === 'timestamp')
            .sort((a, b) => a.order - b.order)[0];
          state.turns[id] = {
            id,
            messageId: message?.getAttribute('data-message-id') || previous?.messageId || '',
            role: section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || '',
            timestampLabel: timestamp?.text || previous?.timestampLabel || '',
            score,
            remaining,
            preCount,
            codeCount,
            textLength,
            html
          };
        }
      }
      return activity();
    }

    function activity() {
      return {
        expanded: state.successfulExpansions,
        clicks: state.clickCount,
        failures: Object.keys(state.failures).length,
        timelineMarkers: Object.keys(state.timelineMarkers).length,
        expandingStatus: state.lastExpansion
      };
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
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            el.click();
            state.clickCount++;
          } catch (error) {
            state.failures[key] = `${shortLabel}: ${error?.message || 'click failed'}`;
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
      const retained = retainedIds();
      const mounted = mountedIds();
      return {
        turns: values.length,
        expanded: state.successfulExpansions,
        clicks: state.clickCount,
        failures: Object.keys(state.failures).length,
        preBlocks: values.reduce((n, turn) => n + (turn.preCount || 0), 0),
        codeBlocks: values.reduce((n, turn) => n + (turn.codeCount || 0), 0),
        timelineMarkers: Object.keys(state.timelineMarkers).length,
        oldestRetained: retained[0] || 'none',
        newestRetained: retained[retained.length - 1] || 'none',
        mountedFirst: mounted[0] || 'none',
        mountedLast: mounted[mounted.length - 1] || 'none',
        expandingStatus: state.lastExpansion,
        oldestConverged: state.oldestVerification.converged,
        oldestQuietChecks: state.oldestVerification.quietChecks,
        oldestChecks: state.oldestVerification.checks
      };
    }

    function markOldestVerification(result) {
      state.oldestVerification = { ...state.oldestVerification, ...result };
    }

    window.__archiveCrawler = { state, capture, activity, expandOne, confirm, metrics, setTop, stats, markOldestVerification };
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
  return { stats, metrics };
}

async function expandMounted(page, max, onProgress, shouldCancel) {
  let expandedSinceFullReport = 0;
  for (let i = 0; i < max; i++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const result = await page.evaluate(() => window.__archiveCrawler.expandOne());
    if (!result) break;
    await page.waitForTimeout(result.kind === 'details' ? 40 : 180);
    if (result.key) await page.evaluate(key => window.__archiveCrawler.confirm(key), result.key);
    const activity = await page.evaluate(() => window.__archiveCrawler.capture());
    expandedSinceFullReport++;

    await onProgress?.({
      ...activity,
      expandingStatus: result.description || activity.expandingStatus || `Expansion ${i + 1}`
    });
    if (expandedSinceFullReport >= 8) {
      await report(page, onProgress);
      expandedSinceFullReport = 0;
    }
  }
  if (expandedSinceFullReport) await report(page, onProgress);
}

async function scan(page, direction, pass, onProgress, shouldCancel, maxSteps = 2000) {
  const requiredStableChecks = 6;
  const first = await page.evaluate(() => window.__archiveCrawler.metrics());
  await page.evaluate(
    top => window.__archiveCrawler.setTop(top),
    direction === 'down' ? 0 : Math.max(0, first.height - first.client)
  );
  await page.waitForTimeout(350);

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
    const signature = [
      Math.round(metrics.top),
      Math.round(metrics.height),
      stats.turns,
      stats.oldestRetained,
      stats.newestRetained,
      stats.mountedFirst,
      stats.mountedLast,
      stats.clicks,
      stats.expanded,
      stats.failures,
      stats.preBlocks,
      stats.codeBlocks,
      stats.timelineMarkers
    ].join('|');

    if (atEnd && signature === previous) stable++;
    else if (atEnd) stable = 1;
    else stable = 0;

    const positionPercent = maxTop <= 0 ? 100 : Math.max(0, Math.min(100, (metrics.top / maxTop) * 100));
    const arrow = direction === 'up' ? '↑' : '↓';
    const edgeStatus = atEnd ? ` · edge stable ${Math.min(stable, requiredStableChecks)}/${requiredStableChecks}` : '';

    await onProgress?.({
      ...stats,
      phase: 'Scanning conversation',
      detail: 'Capturing mounted turns, timeline markers, and disclosures as they appear.',
      scanningStatus: `Pass ${pass}/3 ${arrow} · step ${step + 1}/${maxSteps} · ${positionPercent.toFixed(1)}% mounted range · mounted first ${stats.mountedFirst}${edgeStatus}`,
      scanComplete: false,
      pass,
      direction,
      step: step + 1,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client
    });

    if (atEnd && stable >= requiredStableChecks) break;
    previous = signature;

    const fraction = direction === 'up' ? 0.42 : 0.62;
    const minimumStep = direction === 'up' ? 280 : 320;
    const stepSize = Math.max(minimumStep, Math.floor(metrics.client * fraction));
    const next = direction === 'down'
      ? Math.min(maxTop, metrics.top + stepSize)
      : Math.max(0, metrics.top - stepSize);
    await page.evaluate(top => window.__archiveCrawler.setTop(top), next);
    await page.waitForTimeout(direction === 'up' ? 260 : 200);
  }
}

async function verifyOldestMessages(page, onProgress, shouldCancel) {
  const requiredQuietChecks = 12;
  const maxChecks = 180;
  let quietChecks = 0;
  let previousSignature = '';
  let checks = 0;

  await onProgress?.({
    phase: 'Verifying oldest messages',
    detail: 'Live-preview rebuilding is paused while the oldest edge is probed for asynchronously prepended turns.',
    scanningStatus: `Oldest-edge probe · check 0/${maxChecks} · stable 0/${requiredQuietChecks}`,
    scanComplete: false,
    pass: 2,
    direction: 'up',
    step: 0,
    previewPaused: true,
    oldestConverged: null,
    oldestQuietChecks: 0,
    oldestChecks: 0
  });

  for (let check = 0; check < maxChecks; check++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    checks = check + 1;

    await page.evaluate(() => window.__archiveCrawler.setTop(0));
    await page.waitForTimeout(700);
    await expandMounted(page, 220, onProgress, shouldCancel);
    await page.evaluate(() => window.__archiveCrawler.capture());

    const stats = await page.evaluate(() => window.__archiveCrawler.stats());
    const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
    const atTop = metrics.top <= 4;
    const signature = [
      atTop ? 0 : Math.round(metrics.top),
      Math.round(metrics.height),
      stats.turns,
      stats.oldestRetained,
      stats.newestRetained,
      stats.mountedFirst,
      stats.mountedLast,
      stats.preBlocks,
      stats.codeBlocks,
      stats.clicks,
      stats.expanded,
      stats.failures,
      stats.timelineMarkers
    ].join('|');

    if (atTop && signature === previousSignature) quietChecks++;
    else quietChecks = 0;
    previousSignature = signature;

    await onProgress?.({
      ...stats,
      phase: 'Verifying oldest messages',
      scanningStatus: `Oldest-edge probe · check ${checks}/${maxChecks} · stable ${quietChecks}/${requiredQuietChecks} · ${atTop ? 'at top' : `offset ${Math.round(metrics.top)}px`} · mounted first ${stats.mountedFirst}`,
      oldestRetained: stats.oldestRetained,
      scanComplete: false,
      pass: 2,
      direction: 'up',
      step: checks,
      scrollTop: metrics.top,
      scrollHeight: metrics.height,
      scrollClient: metrics.client,
      previewPaused: true,
      oldestConverged: false,
      oldestQuietChecks: quietChecks,
      oldestChecks: checks
    });

    if (quietChecks >= requiredQuietChecks) break;

    if (!atTop) {
      await page.waitForTimeout(260);
      await page.evaluate(() => window.__archiveCrawler.setTop(0));
    } else if (quietChecks >= 2) {
      const maxTop = Math.max(0, metrics.height - metrics.client);
      const nudge = Math.min(maxTop, Math.max(220, Math.floor(metrics.client * 0.38)));
      if (nudge > 0) {
        await page.evaluate(top => window.__archiveCrawler.setTop(top), nudge);
        await page.waitForTimeout(260);
        await page.evaluate(() => window.__archiveCrawler.setTop(0));
      }
    }
    await page.waitForTimeout(420);
  }

  const converged = quietChecks >= requiredQuietChecks;
  const result = { converged, quietChecks, checks, requiredQuietChecks, maxChecks };
  await page.evaluate(value => window.__archiveCrawler.markOldestVerification(value), result);

  await report(page, onProgress, {
    phase: converged ? 'Oldest-message verification complete' : 'Oldest-message verification safety limit reached',
    detail: converged
      ? 'The oldest edge converged; preparing the final downward traversal.'
      : `The oldest edge did not reach ${requiredQuietChecks}/${requiredQuietChecks} quiet checks before the ${maxChecks}-check safety limit; continuing with the final downward traversal and recording a warning in the archive.`,
    scanningStatus: converged
      ? `Oldest-edge probe complete · stable ${quietChecks}/${requiredQuietChecks} after ${checks} checks`
      : `Oldest-edge probe safety limit · stable ${quietChecks}/${requiredQuietChecks} after ${checks}/${maxChecks} checks`,
    pass: 2,
    direction: 'up',
    previewPaused: false,
    oldestConverged: converged,
    oldestQuietChecks: quietChecks,
    oldestChecks: checks
  });
  return result;
}

export async function crawlConversation(page, { onProgress, shouldCancel } = {}) {
  await installCrawler(page);
  await report(page, onProgress, {
    phase: 'Preparing crawler',
    detail: 'Installed page-side capture helpers; preparing the first traversal.',
    scanningStatus: 'Not started',
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false
  });

  await scan(page, 'down', 1, onProgress, shouldCancel);
  await scan(page, 'up', 2, onProgress, shouldCancel);
  const oldest = await verifyOldestMessages(page, onProgress, shouldCancel);
  await scan(page, 'down', 3, onProgress, shouldCancel);

  const traversalSummary = oldest.converged
    ? 'Complete — 3 passes + oldest-edge convergence'
    : `Complete — 3 passes; oldest-edge safety limit (${oldest.quietChecks}/${oldest.requiredQuietChecks} stable)`;

  await onProgress?.({
    phase: 'Final expansion sweep',
    detail: oldest.converged
      ? 'Traversal is complete; opening any disclosures still mounted before the final snapshot.'
      : 'Traversal is complete but the oldest edge hit its safety limit; opening remaining mounted disclosures before the final snapshot.',
    scanningStatus: traversalSummary,
    scanComplete: true,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false,
    oldestConverged: oldest.converged,
    oldestQuietChecks: oldest.quietChecks,
    oldestChecks: oldest.checks
  });
  await expandMounted(page, 500, onProgress, shouldCancel);
  await page.evaluate(() => window.__archiveCrawler.capture());
  await report(page, onProgress, {
    phase: 'Final expansion sweep',
    detail: 'Expansion sweep complete; preparing the final static page.',
    scanningStatus: traversalSummary,
    scanComplete: true,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false,
    oldestConverged: oldest.converged,
    oldestQuietChecks: oldest.quietChecks,
    oldestChecks: oldest.checks
  });
}
