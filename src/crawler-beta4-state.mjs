const MAX_PROCESS_HISTORY_PER_TURN = 24;
const MAX_CONFLICT_FACT_SAMPLES = 16;
const MAX_CANVAS_DATA_URL_CHARS = 32 * 1024 * 1024;

/**
 * Beta4 state extensions deliberately sit on top of the frozen beta3 semantic
 * crawler. They add recovery history, evidence diagnostics, and archive-only
 * canvas preservation without changing semantic revision ownership.
 */
export async function installBeta4State(page) {
  await page.evaluate(({ maxHistory, maxFactSamples, maxCanvasDataUrlChars }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__beta4StateInstalled) return;
    crawler.__beta4StateInstalled = true;

    const state = crawler.state;
    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const textBlockSelector = [
      'p', 'li', 'blockquote', 'td', 'th',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'
    ].join(',');

    state.turnProcessingHistory ||= Object.create(null);
    state.hydrationConflictDiagnostics ||= Object.create(null);
    state.beta4FixedPointCertificates ||= Object.create(null);
    state.beta4VerificationEpoch = Number(state.beta4VerificationEpoch || 0);
    state.beta4TransientRetentionSealed = Boolean(state.beta4TransientRetentionSealed);
    state.mainCanvasCapture ||= { captured: 0, failures: 0 };

    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);

    function hashText(value) {
      const text = String(value || '');
      let fnv = 2166136261;
      let djb = 5381;
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        fnv ^= code;
        fnv = Math.imul(fnv, 16777619);
        djb = Math.imul(djb, 33) ^ code;
      }
      return `${text.length.toString(36)}-${(fnv >>> 0).toString(36)}-${(djb >>> 0).toString(36)}`;
    }

    function contextFor(node) {
      return {
        tag: node?.localName || '',
        interactive: Boolean(node?.closest?.('button,[role="button"],[role="menu"],[role="menuitem"],[aria-haspopup]')),
        hidden: Boolean(node?.closest?.('[hidden],[aria-hidden="true"]')),
        appBlock: Boolean(node?.closest?.('[data-app-block-preview="true"]'))
      };
    }

    function descriptor(kind, value, node) {
      const normalized = normalizeText(value);
      if (!normalized) return null;
      const context = contextFor(node);
      return {
        kind,
        fingerprint: `${kind}:${hashText(normalized)}`,
        preview: normalized.slice(0, 160),
        ...context
      };
    }

    // Mirrors crawler-base semantic fact extraction, but only runs when an
    // active conflict materially changes and keeps bounded diagnostic samples.
    function currentFactDescriptors(section) {
      const facts = [];
      const add = (kind, value, node) => {
        const item = descriptor(kind, value, node);
        if (item) facts.push(item);
      };

      for (const block of section.querySelectorAll(textBlockSelector)) {
        if (block.querySelector(textBlockSelector)) continue;
        add(`text-${block.localName || 'block'}`, block.innerText || block.textContent || '', block);
      }

      for (const element of section.querySelectorAll('*')) {
        if (element.children?.length) continue;
        if (element.closest(textBlockSelector)) continue;
        if (element.closest('button,[role="button"],[role="menu"],[role="menuitem"],[aria-haspopup]')) continue;
        if (element.matches('a,img,svg,canvas,video,math,[data-math-source],[data-app-block-preview="true"]')) continue;
        add('leaf-text', element.innerText || element.textContent || '', element);
      }

      for (const anchor of section.querySelectorAll('a[href]')) {
        add('link', `${normalizeText(anchor.textContent)}@${anchor.href || anchor.getAttribute('href') || ''}`, anchor);
      }
      for (const code of section.querySelectorAll('pre,code')) {
        add(`code-${code.localName || 'code'}`, code.textContent || '', code);
      }
      for (const image of section.querySelectorAll('img')) {
        add('image', `${image.currentSrc || image.src || image.getAttribute('src') || ''}@${image.alt || ''}`, image);
      }
      for (const math of section.querySelectorAll('[data-math-source],math')) {
        if (math.matches('math') && math.closest('[data-math-source]')) continue;
        add('math', [
          math.getAttribute('data-math-source') || '',
          math.getAttribute('aria-label') || '',
          normalizeText(math.textContent || '')
        ].join('@'), math);
      }
      for (const visual of section.querySelectorAll('svg,canvas,video,[data-app-block-preview="true"]')) {
        add(`visual-${visual.localName || 'app'}`, normalizeText(visual.outerHTML || ''), visual);
      }
      if (!facts.length) add('turn-text', section.innerText || section.textContent || section.outerHTML || '', section);
      return facts;
    }

    function counts(values, selector = value => value?.fingerprint || '') {
      const result = new Map();
      for (const value of values || []) {
        const key = selector(value);
        if (!key) continue;
        result.set(key, (result.get(key) || 0) + 1);
      }
      return result;
    }

    const kindOfFingerprint = fingerprint => String(fingerprint || '').split(':', 1)[0] || 'unknown';

    function surplus(left, right) {
      const rightCounts = counts(right);
      const used = new Map();
      const result = [];
      for (const item of left || []) {
        const fingerprint = item?.fingerprint || '';
        const occurrence = (used.get(fingerprint) || 0) + 1;
        used.set(fingerprint, occurrence);
        if (occurrence > (rightCounts.get(fingerprint) || 0)) result.push(item);
      }
      return result;
    }

    function kindCounts(items) {
      const object = Object.create(null);
      for (const item of items || []) {
        const kind = item?.kind || kindOfFingerprint(item?.fingerprint);
        object[kind] = Number(object[kind] || 0) + 1;
      }
      return object;
    }

    function recordHydrationConflictDiagnostics() {
      const active = Object.entries(state.hydrationConflicts || {}).filter(([, conflict]) => conflict?.active);
      for (const [turnId, conflict] of active) {
        const turn = state.turns?.[turnId];
        if (!turn) continue;
        const signature = [
          Number(conflict.lastUpdatedRevision || 0),
          Number(conflict.observedGenerations || 0),
          String(turn.evidenceFingerprint || '')
        ].join('|');
        if (state.hydrationConflictDiagnostics[turnId]?.signature === signature) continue;

        const canonical = turn.canonicalObserved?.semanticFacts || turn.semanticFacts || [];
        const evidence = turn.evidenceFacts || canonical;
        const evidenceExtra = surplus(evidence, canonical).map(item => ({
          fingerprint: item?.fingerprint || '',
          kind: kindOfFingerprint(item?.fingerprint)
        }));

        const section = document.querySelector(`${turnSelector}[data-testid="${CSS.escape(turnId)}"]`);
        const current = section ? currentFactDescriptors(section) : [];
        const canonicalDescriptors = canonical.map(item => ({
          fingerprint: item?.fingerprint || '',
          kind: kindOfFingerprint(item?.fingerprint)
        }));
        const currentOnly = current.length ? surplus(current, canonicalDescriptors) : [];
        const canonicalOnly = current.length ? surplus(canonicalDescriptors, current) : [];

        state.hydrationConflictDiagnostics[turnId] = {
          signature,
          turnId,
          semanticRevision: Number(state.turnRevisions?.[turnId] || 0),
          observedGenerations: Number(conflict.observedGenerations || 0),
          canonicalFactCount: canonical.length,
          evidenceFactCount: evidence.length,
          currentFactCount: current.length,
          evidenceExtraByKind: kindCounts(evidenceExtra),
          currentOnlyByKind: kindCounts(currentOnly),
          canonicalOnlyByKind: kindCounts(canonicalOnly),
          evidenceExtraSamples: evidenceExtra.slice(0, maxFactSamples),
          currentOnlySamples: currentOnly.slice(0, maxFactSamples),
          canonicalOnlySamples: canonicalOnly.slice(0, maxFactSamples)
        };
      }
    }

    function preserveMountedCanvases(targetTurnId = '') {
      const selector = targetTurnId
        ? `${turnSelector}[data-testid="${CSS.escape(targetTurnId)}"]`
        : turnSelector;
      for (const section of document.querySelectorAll(selector)) {
        const turnId = section.getAttribute('data-testid') || '';
        const retained = state.turns?.[turnId];
        const live = [...section.querySelectorAll('canvas')];
        if (!retained?.html || !live.length) continue;

        const holder = document.createElement('div');
        holder.innerHTML = retained.html;
        const captured = [...holder.querySelectorAll('canvas')];
        if (!captured.length) continue;
        let changed = false;

        for (let index = 0; index < Math.min(live.length, captured.length); index++) {
          const source = live[index];
          const target = captured[index];
          try {
            const dataUrl = source.toDataURL?.('image/png') || '';
            if (!dataUrl || dataUrl.length > maxCanvasDataUrlChars) throw new Error('canvas data URL unavailable or exceeds archive bound');
            const image = document.createElement('img');
            image.src = dataUrl;
            image.alt = source.getAttribute('aria-label') || source.getAttribute('title') || 'Canvas captured from conversation';
            const width = Number(source.width || source.getBoundingClientRect?.().width || 0);
            const height = Number(source.height || source.getBoundingClientRect?.().height || 0);
            if (width > 0) image.setAttribute('width', String(Math.round(width)));
            if (height > 0) image.setAttribute('height', String(Math.round(height)));
            target.replaceWith(image);
            state.mainCanvasCapture.captured++;
          } catch {
            const fallback = document.createElement('div');
            fallback.textContent = '[Canvas content could not be serialized]';
            target.replaceWith(fallback);
            state.mainCanvasCapture.failures++;
          }
          changed = true;
        }

        if (changed) {
          retained.html = holder.innerHTML;
          retained.htmlLength = retained.html.length;
        }
      }
    }

    function afterCapture(targetTurnId = '') {
      preserveMountedCanvases(targetTurnId);
      recordHydrationConflictDiagnostics();
    }

    const originalCapture = crawler.capture.bind(crawler);
    const originalCaptureTurn = crawler.captureTurn.bind(crawler);
    const originalCaptureSectionNode = crawler.captureSectionNode?.bind(crawler);
    crawler.capture = (...args) => {
      const result = originalCapture(...args);
      afterCapture();
      return result;
    };
    crawler.captureTurn = targetTurnId => {
      const result = originalCaptureTurn(targetTurnId);
      afterCapture(targetTurnId);
      return result;
    };
    if (originalCaptureSectionNode) {
      crawler.captureSectionNode = section => {
        const targetTurnId = section?.getAttribute?.('data-testid') || '';
        const result = originalCaptureSectionNode(section);
        afterCapture(targetTurnId);
        return result;
      };
    }

    const originalMarkTurnProcessingResult = crawler.markTurnProcessingResult.bind(crawler);
    crawler.markTurnProcessingResult = result => {
      const turnId = String(result?.turnId || '');
      originalMarkTurnProcessingResult(result);
      if (!turnId) return;
      const history = state.turnProcessingHistory[turnId] || (state.turnProcessingHistory[turnId] = []);
      history.push({
        converged: Boolean(result?.converged),
        reason: String(result?.reason || ''),
        revision: Number(result?.revision ?? state.turnRevisions?.[turnId] ?? 0),
        actionable: Number(result?.actionable || 0),
        recoveryEpoch: Number(result?.recoveryEpoch || 0),
        reconciliationRound: Number(result?.reconciliationRound || 0)
      });
      if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
      if (result?.converged) {
        state.beta4FixedPointCertificates[turnId] = {
          turnId,
          semanticRevision: Number(state.turnRevisions?.[turnId] || 0),
          processingConverged: true,
          actionable: Number(result?.actionable || 0),
          verificationEpoch: Number(state.beta4VerificationEpoch || 0)
        };
      }
    };

    const originalStats = crawler.stats.bind(crawler);
    crawler.stats = () => {
      const base = originalStats();
      const generationCounts = Object.values(state.turnGenerationFingerprints || {}).map(value => Object.keys(value || {}).length);
      let failureEvents = 0;
      let recoveredTurns = 0;
      for (const history of Object.values(state.turnProcessingHistory || {})) {
        const hadFailure = history.some(item => item?.converged === false);
        failureEvents += history.filter(item => item?.converged === false).length;
        if (hadFailure && history.at(-1)?.converged === true) recoveredTurns++;
      }
      return {
        ...base,
        turnProcessingFailureEvents: failureEvents,
        turnProcessingRecoveredTurns: recoveredTurns,
        hydrationConflictDiagnosticTurns: Object.keys(state.hydrationConflictDiagnostics || {}).length,
        hydrationConflictDiagnostics: state.mountRetentionSealed
          ? Object.values(state.hydrationConflictDiagnostics || {}).map(value => structuredClone(value))
          : [],
        observedGenerationTotal: generationCounts.reduce((total, value) => total + value, 0),
        observedGenerationMaxPerTurn: generationCounts.length ? Math.max(...generationCounts) : 0,
        mainChatCanvasesCaptured: Number(state.mainCanvasCapture?.captured || 0),
        mainChatCanvasCaptureFailures: Number(state.mainCanvasCapture?.failures || 0),
        beta4VerificationEpoch: Number(state.beta4VerificationEpoch || 0),
        beta4TransientRetentionSealed: Boolean(state.beta4TransientRetentionSealed)
      };
    };

    crawler.beginBeta4VerificationEpoch = () => ++state.beta4VerificationEpoch;
    crawler.resetTurnPhysicalDisclosureAttempts = targetTurnId => {
      const prefix = `${String(targetTurnId || '')}|`;
      if (!prefix || prefix === '|') return;
      for (const key of Object.keys(state.attempts || {})) if (key.startsWith(prefix)) delete state.attempts[key];
      for (const key of Object.keys(state.failures || {})) if (key.startsWith(prefix)) delete state.failures[key];
    };
    crawler.currentFailedTurnIds = () => Object.entries(state.turnProcessingResults || {})
      .filter(([, result]) => result?.converged === false)
      .map(([turnId]) => turnId)
      .sort((left, right) => turnNumber(left) - turnNumber(right) || left.localeCompare(right));
    crawler.beta4ConflictDiagnostics = () => structuredClone(state.hydrationConflictDiagnostics || {});
    crawler.beta4FixedPointCertificates = () => structuredClone(state.beta4FixedPointCertificates || {});

    afterCapture();
  }, {
    maxHistory: MAX_PROCESS_HISTORY_PER_TURN,
    maxFactSamples: MAX_CONFLICT_FACT_SAMPLES,
    maxCanvasDataUrlChars: MAX_CANVAS_DATA_URL_CHARS
  });
}
