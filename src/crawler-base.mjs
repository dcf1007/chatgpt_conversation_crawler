/**
 * Page-side crawler primitives shared by the automatic crawler and the manual
 * diagnostic. This module deliberately contains only browser-page authority:
 * retaining mounted turns, expanding one disclosure, sampling one disclosure,
 * and scroll/diagnostic primitives. Traversal policy lives in crawler-core.mjs.
 */
export async function installCrawler(page) {
  await page.evaluate(() => {
    if (window.__archiveCrawler) return;

    const state = {
      turns: Object.create(null),
      timelineMarkers: Object.create(null),
      attempts: Object.create(null),
      failures: Object.create(null),
      clickCount: 0,
      successfulExpansions: 0,
      lastExpansion: 'No disclosure expansion yet',
      lastExpansionTurn: '',
      oldestVerification: {
        converged: null,
        quietChecks: 0,
        checks: 0,
        requiredQuietChecks: 12,
        maxChecks: 180
      }
    };

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const turnId = element => element.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const label = element => [
      element.getAttribute('aria-label'),
      element.textContent,
      element.getAttribute('title')
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);

    function isDisclosure(element) {
      if (!(element instanceof HTMLElement) || element.getAttribute('aria-expanded') !== 'false') return false;
      if (element.matches('[aria-haspopup],[role="menuitem"]')) return false;
      if (element.getAttribute('aria-controls')) return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(element));
    }

    const keyFor = element => [
      turnId(element),
      element.getAttribute('aria-controls') || '',
      label(element).slice(0, 240)
    ].join('|');

    function scrollRoot() {
      let element = document.querySelector('#thread') || document.querySelector('main#main') || document.querySelector('main');
      while (element && element !== document.documentElement) {
        const style = getComputedStyle(element);
        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 32) return element;
        element = element.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    }

    function metrics() {
      const root = scrollRoot();
      const documentScroll = root === document.scrollingElement || root === document.documentElement || root === document.body;
      return {
        top: documentScroll ? scrollY : root.scrollTop,
        height: root.scrollHeight,
        client: documentScroll ? innerHeight : root.clientHeight
      };
    }

    function setTop(top) {
      const root = scrollRoot();
      const documentScroll = root === document.scrollingElement || root === document.documentElement || root === document.body;
      if (documentScroll) scrollTo(0, top);
      else root.scrollTop = top;
    }

    function retainedIds() {
      return Object.keys(state.turns)
        .sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
    }

    function mountedIds() {
      return turns()
        .map(section => section.getAttribute('data-testid'))
        .filter(Boolean)
        .sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
    }

    function coherentExpansionStatus(mounted) {
      if (state.lastExpansionTurn && !mounted.includes(state.lastExpansionTurn)) {
        state.lastExpansionTurn = '';
        state.lastExpansion = 'No disclosure expansion active in current mounted range';
      }
      return state.lastExpansion;
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
          try { href = new URL(anchor.href, location.href).href; }
          catch { href = anchor.href; }
        }
        const title = (anchor?.textContent || text.replace(/^Branched from\s*/i, ''))
          .replace(/\s+/g, ' ').trim();
        candidates.push({
          element: paragraph,
          kind: 'branch',
          label: 'Branched from',
          text: title ? `Branched from ${title}` : text,
          href,
          title
        });
      }

      candidates.sort((left, right) => {
        if (left.element === right.element) return 0;
        return left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
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

    function richnessVector(turn) {
      return [
        Number(turn.preCount || 0),
        Number(turn.codeCount || 0),
        Number(turn.textLength || 0),
        Number(turn.htmlLength || turn.html?.length || 0),
        -Number(turn.remaining || 0)
      ];
    }

    function isRicher(candidate, previous) {
      if (!previous) return true;
      const candidateVector = richnessVector(candidate);
      const previousVector = richnessVector(previous);
      for (let index = 0; index < candidateVector.length; index++) {
        if (candidateVector[index] !== previousVector[index]) {
          return candidateVector[index] > previousVector[index];
        }
      }
      return false;
    }

    function captureSection(section) {
      const id = section?.getAttribute?.('data-testid');
      if (!id) return false;

      // Native details are safe to open directly. Do so before cloning so a
      // retained turn never loses content merely because <details> was closed.
      for (const details of section.querySelectorAll('details')) details.open = true;
      const clone = section.cloneNode(true);

      const originalImages = [...section.querySelectorAll('img')];
      [...clone.querySelectorAll('img')].forEach((image, index) => {
        const original = originalImages[index];
        const source = original?.currentSrc || original?.src || image.src;
        if (source) {
          try { image.src = new URL(source, location.href).href; }
          catch {}
        }
        image.removeAttribute('srcset');
        image.loading = 'eager';

        if (!original) return;
        const rect = original.getBoundingClientRect();
        const naturalWidth = Number(original.naturalWidth || 0);
        const naturalHeight = Number(original.naturalHeight || 0);
        const displayWidth = Math.round(rect.width || 0) || Number(original.getAttribute('width') || 0) || naturalWidth;
        const displayHeight = Math.round(rect.height || 0) || Number(original.getAttribute('height') || 0) || naturalHeight;
        if (displayWidth > 0) image.setAttribute('width', String(displayWidth));
        if (displayHeight > 0) image.setAttribute('height', String(displayHeight));
        if (naturalWidth > 0) image.setAttribute('data-natural-width', String(naturalWidth));
        if (naturalHeight > 0) image.setAttribute('data-natural-height', String(naturalHeight));
      });

      const originalLinks = [...section.querySelectorAll('a[href]')];
      [...clone.querySelectorAll('a[href]')].forEach((anchor, index) => {
        const href = originalLinks[index]?.href || anchor.href;
        if (!href) return;
        try { anchor.href = new URL(href, location.href).href; }
        catch {}
      });

      const remaining = [...section.querySelectorAll('[aria-expanded="false"]')].filter(isDisclosure).length
        + section.querySelectorAll('details:not([open])').length;
      const preCount = section.querySelectorAll('pre').length;
      const codeCount = section.querySelectorAll('code').length;
      const textLength = (section.innerText || section.textContent || '').length;
      const html = clone.outerHTML;
      const candidate = {
        remaining,
        preCount,
        codeCount,
        textLength,
        htmlLength: html.length,
        html
      };
      const previous = state.turns[id];
      if (!isRicher(candidate, previous)) return false;

      const message = section.querySelector('[data-message-id]');
      const timestamp = Object.values(state.timelineMarkers)
        .filter(marker => marker.beforeTurn === id && marker.kind === 'timestamp')
        .sort((left, right) => left.order - right.order)[0];
      state.turns[id] = {
        id,
        messageId: message?.getAttribute('data-message-id') || previous?.messageId || '',
        role: section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || '',
        timestampLabel: timestamp?.text || previous?.timestampLabel || '',
        remaining,
        preCount,
        codeCount,
        textLength,
        htmlLength: html.length,
        html
      };
      return true;
    }

    function captureTurn(targetTurnId) {
      const section = turns().find(turn => turn.getAttribute('data-testid') === targetTurnId);
      if (section) captureSection(section);
      return activity();
    }

    function capture() {
      captureTimelineMarkers();
      for (const section of turns()) captureSection(section);
      return activity();
    }

    function activity() {
      const retained = retainedIds();
      const mounted = mountedIds();
      return {
        expanded: state.successfulExpansions,
        clicks: state.clickCount,
        failures: Object.keys(state.failures).length,
        timelineMarkers: Object.keys(state.timelineMarkers).length,
        oldestRetained: retained[0] || 'none',
        newestRetained: retained[retained.length - 1] || 'none',
        mountedFirst: mounted[0] || 'none',
        mountedLast: mounted[mounted.length - 1] || 'none',
        expandingStatus: coherentExpansionStatus(mounted)
      };
    }

    function expandOne(targetTurnId = '') {
      const candidateTurns = targetTurnId
        ? turns().filter(section => section.getAttribute('data-testid') === targetTurnId)
        : turns();

      for (const section of candidateTurns) {
        const details = section.querySelector('details:not([open])');
        if (!details) continue;
        details.open = true;
        state.successfulExpansions++;
        state.lastExpansionTurn = turnId(details);
        state.lastExpansion = `${state.lastExpansionTurn} — opened native <details>`;
        return {
          kind: 'details',
          description: state.lastExpansion,
          turnId: state.lastExpansionTurn
        };
      }

      for (const section of candidateTurns) {
        for (const element of section.querySelectorAll('[aria-expanded="false"]')) {
          if (!isDisclosure(element)) continue;
          const key = keyFor(element);
          const attempts = state.attempts[key] || 0;
          if (attempts >= 3) continue;

          state.attempts[key] = attempts + 1;
          const shortLabel = label(element).slice(0, 180)
            || element.getAttribute('aria-controls')
            || 'unlabelled disclosure';
          state.lastExpansionTurn = turnId(element);
          state.lastExpansion = `${state.lastExpansionTurn} — ${shortLabel}`;
          const controls = element.getAttribute('aria-controls') || '';
          try {
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            element.click();
            state.clickCount++;
          } catch (error) {
            state.failures[key] = `${shortLabel}: ${error?.message || 'click failed'}`;
          }
          return {
            kind: 'click',
            key,
            controls,
            turnId: state.lastExpansionTurn,
            description: state.lastExpansion
          };
        }
      }
      return null;
    }

    function findDisclosureByKey(key) {
      for (const section of turns()) {
        for (const element of section.querySelectorAll('[aria-expanded]')) {
          if (keyFor(element) === key) return element;
        }
      }
      return null;
    }

    function sampleNode(node) {
      if (!node) {
        return {
          textLength: 0,
          htmlLength: 0,
          preCount: 0,
          codeCount: 0,
          mediaCount: 0,
          childCount: 0
        };
      }
      return {
        textLength: (node.innerText || node.textContent || '').length,
        htmlLength: (node.outerHTML || '').length,
        preCount: node.querySelectorAll?.('pre').length || 0,
        codeCount: node.querySelectorAll?.('code').length || 0,
        mediaCount: node.querySelectorAll?.('img,svg,canvas,video').length || 0,
        childCount: node.querySelectorAll?.('*').length || 0
      };
    }

    function disclosureSample(key) {
      const element = findDisclosureByKey(key);
      if (!element) {
        return {
          present: false,
          expanded: false,
          targetExists: false,
          turnId: '',
          signature: 'missing'
        };
      }

      const controls = element.getAttribute('aria-controls') || '';
      const turn = element.closest(turnSelector);
      const target = controls ? document.getElementById(controls) : turn;
      const targetMetrics = sampleNode(target || turn);
      const turnMetrics = sampleNode(turn);
      return {
        present: true,
        expanded: element.getAttribute('aria-expanded') !== 'false',
        targetExists: !controls || Boolean(target),
        controls,
        turnId: turn?.getAttribute('data-testid') || '',
        signature: [
          targetMetrics.textLength,
          targetMetrics.htmlLength,
          targetMetrics.preCount,
          targetMetrics.codeCount,
          targetMetrics.mediaCount,
          targetMetrics.childCount,
          turnMetrics.textLength,
          turnMetrics.htmlLength,
          turnMetrics.preCount,
          turnMetrics.codeCount,
          turnMetrics.mediaCount,
          turnMetrics.childCount
        ].join('|')
      };
    }

    function confirm(key) {
      if (!key) return;
      const collapsed = turns().some(section =>
        [...section.querySelectorAll('[aria-expanded="false"]')]
          .some(element => isDisclosure(element) && keyFor(element) === key)
      );

      if (!collapsed) {
        state.successfulExpansions++;
        // Retry state is scoped to one activation attempt. A disclosure that
        // later remounts collapsed must be eligible again after a prior success.
        delete state.attempts[key];
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
        preBlocks: values.reduce((total, turn) => total + (turn.preCount || 0), 0),
        codeBlocks: values.reduce((total, turn) => total + (turn.codeCount || 0), 0),
        timelineMarkers: Object.keys(state.timelineMarkers).length,
        oldestRetained: retained[0] || 'none',
        newestRetained: retained[retained.length - 1] || 'none',
        mountedFirst: mounted[0] || 'none',
        mountedLast: mounted[mounted.length - 1] || 'none',
        expandingStatus: coherentExpansionStatus(mounted),
        oldestConverged: state.oldestVerification.converged,
        oldestQuietChecks: state.oldestVerification.quietChecks,
        oldestChecks: state.oldestVerification.checks
      };
    }

    function markOldestVerification(result) {
      state.oldestVerification = { ...state.oldestVerification, ...result };
    }

    window.__archiveCrawler = {
      state,
      capture,
      captureTurn,
      activity,
      expandOne,
      confirm,
      disclosureSample,
      metrics,
      setTop,
      stats,
      markOldestVerification
    };
    capture();
  });
}
