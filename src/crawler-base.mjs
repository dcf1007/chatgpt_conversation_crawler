// Page-side crawler primitives. Traversal policy lives in crawler-traversal.mjs.
export async function installCrawler(page) {
  await page.evaluate(() => {
    if (window.__archiveCrawler) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const contentUnitSelector = [
      'pre', 'blockquote', 'table', 'figure',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'li', 'img', 'svg', 'canvas', 'video',
      '[data-app-block-preview="true"]'
    ].join(',');

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
      },
      retainedRevision: 0,
      turnRevisions: Object.create(null),
      turnGenerationFingerprints: Object.create(null),
      hydrationConflicts: Object.create(null),
      hydrationConflictsResolved: 0,
      hydrationConflictDetections: 0,
      scanResults: [],
      expansionLimitEvents: [],
      hydrationTimeoutEvents: []
    };

    const turns = () => [...document.querySelectorAll(turnSelector)];
    const turnId = element => element.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const label = element => normalizeText([
      element.getAttribute('aria-label'),
      element.textContent,
      element.getAttribute('title')
    ].filter(Boolean).join(' '));

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
      const documentRoot = root === document.scrollingElement || root === document.documentElement || root === document.body;
      return {
        top: documentRoot ? scrollY : root.scrollTop,
        height: root.scrollHeight,
        client: documentRoot ? innerHeight : root.clientHeight
      };
    }

    function setTop(top) {
      const root = scrollRoot();
      const documentRoot = root === document.scrollingElement || root === document.documentElement || root === document.body;
      if (documentRoot) scrollTo(0, top);
      else root.scrollTop = top;
    }

    function retainedIds() {
      return Object.keys(state.turns).sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
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
        const text = normalizeText(separator.getAttribute('aria-label') || separator.textContent || '');
        if (text) candidates.push({ element: separator, kind: 'timestamp', label: text, text, href: '' });
      }

      for (const anchor of document.querySelectorAll('main p a[href*="/c/"]')) {
        const paragraph = anchor.closest('p');
        if (!paragraph || paragraph.closest(turnSelector)) continue;
        const text = normalizeText(paragraph.textContent || '');
        if (!/^Branched from\b/i.test(text)) continue;

        let href = '';
        if (anchor?.href) {
          try { href = new URL(anchor.href, location.href).href; }
          catch { href = anchor.href; }
        }
        const title = normalizeText(anchor?.textContent || text.replace(/^Branched from\s*/i, ''));
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
      return Object.keys(state.timelineMarkers).length;
    }

    function richnessVector(turn) {
      return [
        Number(turn.preCount || 0),
        Number(turn.codeCount || 0),
        Number(turn.mediaCount || 0),
        Number(turn.appBlockCount || 0),
        -Number(turn.remaining || 0),
        Number(turn.htmlLength || turn.html?.length || 0),
        Number(turn.textLength || 0),
        Number(turn.elementCount || 0)
      ];
    }

    function isMetricRicher(candidate, previous) {
      if (!previous) return true;
      const left = richnessVector(candidate);
      const right = richnessVector(previous);
      for (let index = 0; index < left.length; index++) {
        if (left[index] !== right[index]) return left[index] > right[index];
      }
      return false;
    }

    function hashText(value) {
      let hash = 2166136261;
      const text = String(value || '');
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function stableNodeFingerprint(node) {
      const tag = node.tagName?.toLowerCase?.() || 'text';
      const text = normalizeText(node.innerText || node.textContent || '');
      const links = [...(node.querySelectorAll?.('a[href]') || [])]
        .map(anchor => `${normalizeText(anchor.textContent)}@${anchor.href || anchor.getAttribute('href') || ''}`)
        .join('|');
      const images = [...(node.querySelectorAll?.('img') || [])]
        .map(image => `${image.currentSrc || image.src || image.getAttribute('src') || ''}@${image.alt || ''}`)
        .join('|');
      const ownSource = tag === 'img'
        ? `${node.currentSrc || node.src || node.getAttribute('src') || ''}@${node.alt || ''}`
        : '';
      const math = node.getAttribute?.('data-math-source') || node.getAttribute?.('aria-label') || '';
      const structural = !text && !links && !images && !ownSource
        ? normalizeText(node.outerHTML || '')
        : '';
      return `${tag}:${hashText([text, links, images, ownSource, math, structural].join('\u0000'))}`;
    }

    function extractContentUnits(section) {
      const selected = [...section.querySelectorAll(contentUnitSelector)].filter(node => {
        const parent = node.parentElement?.closest?.(contentUnitSelector);
        return !parent || !section.contains(parent);
      });

      const children = section.children ? [...section.children] : [];
      const nodes = selected.length ? selected : children.length ? children : [section];

      return nodes.map(node => ({
        fingerprint: stableNodeFingerprint(node),
        html: node.outerHTML || normalizeText(node.textContent || '')
      }));
    }

    function unitCounts(units) {
      const counts = new Map();
      for (const unit of units || []) counts.set(unit.fingerprint, (counts.get(unit.fingerprint) || 0) + 1);
      return counts;
    }

    function coversUnits(containerUnits, requiredUnits) {
      const available = unitCounts(containerUnits);
      const required = unitCounts(requiredUnits);
      for (const [fingerprint, count] of required) {
        if ((available.get(fingerprint) || 0) < count) return false;
      }
      return true;
    }

    function unionUnits(primaryUnits, secondaryUnits) {
      const result = [...(primaryUnits || [])];
      const present = unitCounts(primaryUnits);
      const usedSecondary = new Map();

      for (const unit of secondaryUnits || []) {
        const used = (usedSecondary.get(unit.fingerprint) || 0) + 1;
        usedSecondary.set(unit.fingerprint, used);
        if (used <= (present.get(unit.fingerprint) || 0)) continue;
        result.push(unit);
      }
      return result;
    }

    function generationFingerprint(candidate) {
      const counts = [...unitCounts(candidate.contentUnits).entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([fingerprint, count]) => `${fingerprint}:${count}`)
        .join('|');
      return hashText(`${counts}\u0000remaining:${Number(candidate.remaining || 0)}`);
    }

    function noteGeneration(turnIdValue, fingerprint) {
      const seen = state.turnGenerationFingerprints[turnIdValue] || (state.turnGenerationFingerprints[turnIdValue] = Object.create(null));
      if (seen[fingerprint]) return false;
      seen[fingerprint] = true;
      state.retainedRevision++;
      state.turnRevisions[turnIdValue] = Number(state.turnRevisions[turnIdValue] || 0) + 1;
      return true;
    }

    function mergeTurnHtml(baseTurn, union) {
      const holder = document.createElement('div');
      holder.innerHTML = baseTurn.html || '';
      const section = holder.firstElementChild;
      if (!section) return baseTurn.html || '';

      const existingCounts = unitCounts(baseTurn.contentUnits || []);
      const seenUnion = new Map();
      let mergeContainer = section.querySelector('[data-archive-hydration-merge="true"]');

      for (const unit of union) {
        const occurrence = (seenUnion.get(unit.fingerprint) || 0) + 1;
        seenUnion.set(unit.fingerprint, occurrence);
        if (occurrence <= (existingCounts.get(unit.fingerprint) || 0)) continue;

        if (!mergeContainer) {
          mergeContainer = document.createElement('div');
          mergeContainer.setAttribute('data-archive-hydration-merge', 'true');
          section.append(mergeContainer);
        }
        const fragment = document.createElement('template');
        fragment.innerHTML = unit.html;
        if (fragment.content.childNodes.length) mergeContainer.append(fragment.content.cloneNode(true));
      }
      return section.outerHTML;
    }

    function hydrationConflictIds() {
      return Object.entries(state.hydrationConflicts)
        .filter(([, conflict]) => conflict?.active)
        .map(([id]) => id)
        .sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
    }

    function resolveConflictIfNeeded(id, previous, next) {
      const conflict = state.hydrationConflicts[id];
      if (!conflict?.active) return;
      if (!coversUnits(next.contentUnits, previous.contentUnits)) return;
      conflict.active = false;
      conflict.resolvedAtRevision = Number(state.turnRevisions[id] || 0);
      state.hydrationConflictsResolved++;
      next.hydrationConflictActive = false;
    }

    function markConflict(id, previous, candidate, union) {
      const existing = state.hydrationConflicts[id];
      if (!existing?.active) state.hydrationConflictDetections++;
      state.hydrationConflicts[id] = {
        active: true,
        firstDetectedRevision: existing?.firstDetectedRevision || Number(state.turnRevisions[id] || 0),
        lastUpdatedRevision: Number(state.turnRevisions[id] || 0),
        observedGenerations: Object.keys(state.turnGenerationFingerprints[id] || {}).length,
        retainedUnits: union.length
      };

      const base = isMetricRicher(candidate, previous) ? candidate : previous;
      const mergedHtml = mergeTurnHtml(base, union);
      return {
        ...base,
        html: mergedHtml,
        htmlLength: mergedHtml.length,
        contentUnits: union,
        remaining: Math.min(Number(previous.remaining || 0), Number(candidate.remaining || 0)),
        preCount: Math.max(Number(previous.preCount || 0), Number(candidate.preCount || 0)),
        codeCount: Math.max(Number(previous.codeCount || 0), Number(candidate.codeCount || 0)),
        mediaCount: Math.max(Number(previous.mediaCount || 0), Number(candidate.mediaCount || 0)),
        appBlockCount: Math.max(Number(previous.appBlockCount || 0), Number(candidate.appBlockCount || 0)),
        elementCount: Math.max(Number(previous.elementCount || 0), Number(candidate.elementCount || 0)),
        textLength: Math.max(Number(previous.textLength || 0), Number(candidate.textLength || 0)),
        hydrationConflictActive: true
      };
    }

    function captureSection(section) {
      const id = section?.getAttribute?.('data-testid');
      if (!id) return false;

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
      const html = clone.outerHTML;
      const contentUnits = extractContentUnits(clone);
      const candidate = {
        remaining,
        preCount: section.querySelectorAll('pre').length,
        codeCount: section.querySelectorAll('code').length,
        mediaCount: section.querySelectorAll('img,svg,canvas,video').length,
        appBlockCount: section.querySelectorAll('[data-app-block-preview="true"]').length,
        elementCount: section.querySelectorAll('*').length,
        textLength: (section.innerText || section.textContent || '').length,
        htmlLength: html.length,
        html,
        contentUnits,
        hydrationConflictActive: false
      };
      candidate.generationFingerprint = generationFingerprint(candidate);
      noteGeneration(id, candidate.generationFingerprint);

      const previous = state.turns[id];
      const message = section.querySelector('[data-message-id]');
      const timestamp = Object.values(state.timelineMarkers)
        .filter(marker => marker.beforeTurn === id && marker.kind === 'timestamp')
        .sort((left, right) => left.order - right.order)[0];
      const identity = {
        id,
        messageId: message?.getAttribute('data-message-id') || previous?.messageId || '',
        role: section.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role') || previous?.role || '',
        timestampLabel: timestamp?.text || previous?.timestampLabel || ''
      };

      if (!previous) {
        state.turns[id] = { ...identity, ...candidate };
        return true;
      }

      const candidateCoversPrevious = coversUnits(candidate.contentUnits, previous.contentUnits || []);
      const previousCoversCandidate = coversUnits(previous.contentUnits || [], candidate.contentUnits);

      let next = previous;
      if (candidateCoversPrevious && !previousCoversCandidate) {
        next = { ...identity, ...candidate };
        resolveConflictIfNeeded(id, previous, next);
      } else if (candidateCoversPrevious && previousCoversCandidate) {
        const candidatePreferred = Boolean(state.hydrationConflicts[id]?.active)
          || Number(candidate.remaining || 0) < Number(previous.remaining || 0)
          || (Number(candidate.remaining || 0) === Number(previous.remaining || 0) && isMetricRicher(candidate, previous));
        if (candidatePreferred) {
          next = { ...identity, ...candidate };
          resolveConflictIfNeeded(id, previous, next);
        }
      } else if (!candidateCoversPrevious && !previousCoversCandidate) {
        const union = unionUnits(previous.contentUnits || [], candidate.contentUnits);
        const merged = markConflict(id, previous, candidate, union);
        next = { ...identity, ...merged };
      }

      if (next === previous) return false;
      state.turns[id] = next;
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
        newestRetained: retained.at(-1) || 'none',
        mountedFirst: mounted[0] || 'none',
        mountedLast: mounted.at(-1) || 'none',
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
        return { kind: 'details', description: state.lastExpansion, turnId: state.lastExpansionTurn };
      }

      for (const section of candidateTurns) {
        for (const element of section.querySelectorAll('[aria-expanded="false"]')) {
          if (!isDisclosure(element)) continue;
          const key = keyFor(element);
          const attempts = state.attempts[key] || 0;
          if (attempts >= 3) continue;
          state.attempts[key] = attempts + 1;
          const shortLabel = label(element).slice(0, 180) || element.getAttribute('aria-controls') || 'unlabelled disclosure';
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
          return { kind: 'click', key, controls, turnId: state.lastExpansionTurn, description: state.lastExpansion };
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
      if (!node) return { textLength: 0, htmlLength: 0, preCount: 0, codeCount: 0, mediaCount: 0, childCount: 0 };
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
      if (!element) return { present: false, expanded: false, targetExists: false, turnId: '', signature: 'missing' };
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
          targetMetrics.textLength, targetMetrics.htmlLength, targetMetrics.preCount,
          targetMetrics.codeCount, targetMetrics.mediaCount, targetMetrics.childCount,
          turnMetrics.textLength, turnMetrics.htmlLength, turnMetrics.preCount,
          turnMetrics.codeCount, turnMetrics.mediaCount, turnMetrics.childCount
        ].join('|')
      };
    }

    function confirm(key) {
      if (!key) return;
      const collapsed = turns().some(section => [...section.querySelectorAll('[aria-expanded="false"]')]
        .some(element => isDisclosure(element) && keyFor(element) === key));
      if (!collapsed) {
        state.successfulExpansions++;
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
      const unresolvedHydrationIds = hydrationConflictIds();
      return {
        turns: values.length,
        expanded: state.successfulExpansions,
        clicks: state.clickCount,
        failures: Object.keys(state.failures).length,
        preBlocks: values.reduce((total, turn) => total + (turn.preCount || 0), 0),
        codeBlocks: values.reduce((total, turn) => total + (turn.codeCount || 0), 0),
        mediaElements: values.reduce((total, turn) => total + (turn.mediaCount || 0), 0),
        timelineMarkers: Object.keys(state.timelineMarkers).length,
        oldestRetained: retained[0] || 'none',
        newestRetained: retained.at(-1) || 'none',
        mountedFirst: mounted[0] || 'none',
        mountedLast: mounted.at(-1) || 'none',
        expandingStatus: coherentExpansionStatus(mounted),
        oldestConverged: state.oldestVerification.converged,
        oldestQuietChecks: state.oldestVerification.quietChecks,
        oldestChecks: state.oldestVerification.checks,
        retainedRevision: Number(state.retainedRevision || 0),
        hydrationConflictsResolved: Number(state.hydrationConflictsResolved || 0),
        hydrationConflictsUnresolved: unresolvedHydrationIds.length,
        hydrationConflictTurnIds: unresolvedHydrationIds.slice(0, 20),
        hydrationConflictDetections: Number(state.hydrationConflictDetections || 0),
        scanLimitEvents: state.scanResults.filter(result => result && result.converged === false).length,
        expansionLimitEvents: state.expansionLimitEvents.length,
        hydrationTimeoutEvents: state.hydrationTimeoutEvents.length
      };
    }

    function markOldestVerification(result) {
      state.oldestVerification = { ...state.oldestVerification, ...result };
    }

    function markScanResult(result) {
      state.scanResults.push({ ...result });
    }

    function noteExpansionLimit(result) {
      state.expansionLimitEvents.push({ ...result });
    }

    function noteHydrationTimeout(result) {
      state.hydrationTimeoutEvents.push({ ...result });
    }

    window.__archiveCrawler = {
      state,
      capture,
      captureTurn,
      captureTimelineMarkers,
      activity,
      expandOne,
      confirm,
      disclosureSample,
      metrics,
      setTop,
      stats,
      markOldestVerification,
      markScanResult,
      noteExpansionLimit,
      noteHydrationTimeout,
      turnRevision: targetTurnId => Number(state.turnRevisions[targetTurnId] || 0),
      retainedRevision: () => Number(state.retainedRevision || 0)
    };
    capture();
  });
}
