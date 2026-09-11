export const TURN_QUIESCENT_REQUIRED_ROUNDS = 3;
export const MAX_UNRECOGNIZED_LABELS = 12;

/** Install disclosure/quiescence state required by the automatic crawler. */
export async function installDisclosureState(page) {
  await page.evaluate(({ requiredRounds, maxLabels }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__disclosureStateInstalled) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const label = element => [element.getAttribute('aria-label'), element.textContent, element.getAttribute('title')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const normalizedLabel = element => String(
      element.getAttribute('aria-label') || element.textContent || element.getAttribute('title') || ''
    ).replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240);
    const turnId = element => element.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const keyFor = element => [turnId(element), element.getAttribute('aria-controls') || '', label(element).slice(0, 240)].join('|');
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

    function isDisclosureControl(element, { collapsedOnly = true } = {}) {
      if (!(element instanceof HTMLElement)) return false;
      if (collapsedOnly && element.getAttribute('aria-expanded') !== 'false') return false;
      if (!collapsedOnly && element.getAttribute('aria-expanded') == null) return false;
      if (element.matches('[aria-haspopup],[role="menuitem"]')) return false;
      if (element.getAttribute('aria-controls')) return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(element));
    }

    function logicalControlKey(element) {
      const section = element.closest(turnSelector);
      const id = section?.getAttribute('data-testid') || 'unknown-turn';
      const normalized = normalizedLabel(element);
      const stableLabel = normalized || (element.getAttribute('aria-controls') || 'unlabelled disclosure').toLowerCase();
      const peers = section
        ? [...section.querySelectorAll('[aria-expanded]')].filter(candidate => isDisclosureControl(candidate, { collapsedOnly: false }) && normalizedLabel(candidate) === normalized)
        : [element];
      const occurrence = Math.max(0, peers.indexOf(element));
      return [id, 'control', stableLabel, occurrence].join('|');
    }

    function logicalDetailsKey(details) {
      const section = details.closest(turnSelector);
      const id = section?.getAttribute('data-testid') || 'unknown-turn';
      const summary = (details.querySelector('summary')?.textContent || 'native details').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240);
      const peers = section
        ? [...section.querySelectorAll('details')].filter(candidate => ((candidate.querySelector('summary')?.textContent || 'native details').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240)) === summary)
        : [details];
      const occurrence = Math.max(0, peers.indexOf(details));
      return [id, 'details', summary, occurrence].join('|');
    }

    function turnRevision(targetTurnId) {
      return Number(crawler.state?.turnRevisions?.[targetTurnId] || 0);
    }

    function completionRevision(logicalKey) {
      if (!hasOwn(crawler.state?.disclosureCompletions, logicalKey)) return null;
      return Number(crawler.state.disclosureCompletions[logicalKey] || 0);
    }

    function logicalActionable(logicalKey, targetTurnId) {
      const completedAt = completionRevision(logicalKey);
      return completedAt === null || completedAt < turnRevision(targetTurnId);
    }

    function sampleNode(node) {
      return node ? {
        textLength: (node.innerText || node.textContent || '').length,
        htmlLength: (node.outerHTML || '').length,
        preCount: node.querySelectorAll?.('pre').length || 0,
        codeCount: node.querySelectorAll?.('code').length || 0,
        mediaCount: node.querySelectorAll?.('img,svg,canvas,video').length || 0,
        childCount: node.querySelectorAll?.('*').length || 0
      } : { textLength: 0, htmlLength: 0, preCount: 0, codeCount: 0, mediaCount: 0, childCount: 0 };
    }

    function sectionState(section) {
      const collapsed = [...section.querySelectorAll('[aria-expanded="false"]')];
      const recognizedKeys = [];
      const actionableKeys = [];
      const recognizedLogicalKeys = [];
      const actionableLogicalKeys = [];
      for (const element of collapsed) {
        if (!isDisclosureControl(element)) continue;
        const key = keyFor(element);
        const logicalKey = logicalControlKey(element);
        recognizedKeys.push(key);
        recognizedLogicalKeys.push(logicalKey);
        if (Number(crawler.state?.attempts?.[key] || 0) < 3 && logicalActionable(logicalKey, turnId(element))) {
          actionableKeys.push(key);
          actionableLogicalKeys.push(logicalKey);
        }
      }

      const closedDetailLogicalKeys = [];
      const actionableDetailLogicalKeys = [];
      for (const details of section.querySelectorAll('details:not([open])')) {
        const logicalKey = logicalDetailsKey(details);
        closedDetailLogicalKeys.push(logicalKey);
        if (logicalActionable(logicalKey, turnId(details))) actionableDetailLogicalKeys.push(logicalKey);
      }

      recognizedKeys.sort();
      actionableKeys.sort();
      recognizedLogicalKeys.sort();
      actionableLogicalKeys.push(...actionableDetailLogicalKeys);
      actionableLogicalKeys.sort();
      closedDetailLogicalKeys.sort();
      return {
        allCollapsedControls: collapsed.length,
        recognizedCollapsed: recognizedKeys.length,
        actionableCollapsed: actionableKeys.length + actionableDetailLogicalKeys.length,
        closedDetails: closedDetailLogicalKeys.length,
        actionableClosedDetails: actionableDetailLogicalKeys.length,
        recognizedKeys,
        actionableKeys,
        recognizedLogicalKeys,
        actionableLogicalKeys,
        closedDetailLogicalKeys
      };
    }

    function mountedDisclosureState() {
      let allCollapsedControls = 0;
      let recognizedCollapsed = 0;
      let actionableCollapsed = 0;
      let closedDetails = 0;
      const actionableLogicalKeys = [];
      const unrecognizedCollapsedLabels = [];
      for (const section of turns()) {
        const current = sectionState(section);
        allCollapsedControls += current.allCollapsedControls;
        recognizedCollapsed += current.recognizedCollapsed;
        actionableCollapsed += current.actionableCollapsed;
        closedDetails += current.closedDetails;
        actionableLogicalKeys.push(...current.actionableLogicalKeys);
        if (unrecognizedCollapsedLabels.length >= maxLabels) continue;
        for (const element of section.querySelectorAll('[aria-expanded="false"]')) {
          if (isDisclosureControl(element)) continue;
          const text = label(element).slice(0, 180) || element.tagName?.toLowerCase?.() || 'unlabelled control';
          unrecognizedCollapsedLabels.push(`${turnId(element)} — ${text}`);
          if (unrecognizedCollapsedLabels.length >= maxLabels) break;
        }
      }
      actionableLogicalKeys.sort();
      return { allCollapsedControls, recognizedCollapsed, actionableCollapsed, closedDetails, actionableLogicalKeys, unrecognizedCollapsedLabels };
    }

    function turnDisclosureSample(targetTurnId) {
      const section = turns().find(turn => turn.getAttribute('data-testid') === targetTurnId);
      if (!section) {
        return { mounted: false, turnId: targetTurnId, actionableCollapsed: 0, recognizedCollapsed: 0, closedDetails: 0, actionableLogicalKeys: [], signature: `missing:${targetTurnId}` };
      }
      const metrics = sampleNode(section);
      const disclosure = sectionState(section);
      return {
        mounted: true,
        turnId: targetTurnId,
        turnRevision: turnRevision(targetTurnId),
        ...metrics,
        ...disclosure,
        signature: [
          targetTurnId,
          turnRevision(targetTurnId),
          disclosure.actionableCollapsed,
          disclosure.actionableLogicalKeys.join('~')
        ].join('|')
      };
    }

    function mountedDisclosureSample() {
      const actionableLogicalKeys = [];
      let recognizedCollapsed = 0;
      let actionableCollapsed = 0;
      let closedDetails = 0;
      for (const section of turns()) {
        const disclosure = sectionState(section);
        recognizedCollapsed += disclosure.recognizedCollapsed;
        actionableCollapsed += disclosure.actionableCollapsed;
        closedDetails += disclosure.closedDetails;
        actionableLogicalKeys.push(...disclosure.actionableLogicalKeys);
      }
      actionableLogicalKeys.sort();
      return {
        recognizedCollapsed,
        actionableCollapsed,
        closedDetails,
        actionableLogicalKeys,
        signature: actionableLogicalKeys.join('|')
      };
    }

    function retainedDisclosureSummary() {
      const unresolved = Object.values(crawler.state?.turns || {})
        .filter(turn => Number(turn.remaining || 0) > 0)
        .sort((left, right) => turnNumber(left.id) - turnNumber(right.id) || String(left.id).localeCompare(String(right.id)));
      return {
        retainedUnresolvedTurns: unresolved.length,
        retainedUnresolvedDisclosures: unresolved.reduce((total, turn) => total + Number(turn.remaining || 0), 0),
        retainedUnresolvedTurnIds: unresolved.slice(0, maxLabels).map(turn => turn.id),
        fingerprint: unresolved.map(turn => [
          turn.id, Number(turn.remaining || 0), Number(turn.preCount || 0), Number(turn.codeCount || 0),
          Number(turn.mediaCount || 0), Number(turn.textLength || 0), Number(turn.htmlLength || turn.html?.length || 0)
        ].join(':')).join('|')
      };
    }

    function retainedCorpusFingerprint() {
      return Object.values(crawler.state?.turns || {})
        .sort((left, right) => turnNumber(left.id) - turnNumber(right.id) || String(left.id).localeCompare(String(right.id)))
        .map(turn => [
          turn.id,
          Number(turn.remaining || 0),
          Number(turn.preCount || 0),
          Number(turn.codeCount || 0),
          Number(turn.mediaCount || 0),
          Number(turn.appBlockCount || 0),
          Number(turn.textLength || 0),
          Number(turn.htmlLength || turn.html?.length || 0),
          Number(turn.elementCount || 0)
        ].join(':')).join('|');
    }

    // Turn revisions are owned by crawler-base and advance only for genuinely
    // novel semantic generations. This keeps disclosure liveness independent
    // from which generation wins archival retention and prevents a known poorer
    // remount from reopening an already-proven disclosure forever.
    crawler.state.retainedRevision = Number(crawler.state.retainedRevision || 0);
    crawler.state.turnRevisions = crawler.state.turnRevisions || Object.create(null);
    crawler.state.disclosureCompletions = crawler.state.disclosureCompletions || Object.create(null);
    crawler.retainedRevision = () => Number(crawler.state.retainedRevision || 0);
    crawler.turnRevision = targetTurnId => turnRevision(targetTurnId);
    crawler.retainedCorpusFingerprint = retainedCorpusFingerprint;
    crawler.logicalDisclosureKey = element => logicalControlKey(element);
    crawler.disclosureCompletionRevision = logicalKey => completionRevision(logicalKey);
    crawler.markDisclosureComplete = value => {
      const logicalKey = String(value?.logicalKey || '');
      const targetTurnId = String(value?.turnId || '');
      if (!logicalKey || !targetTurnId) return;
      crawler.state.disclosureCompletions[logicalKey] = turnRevision(targetTurnId);
    };

    // Override the beta11 page-side selector so persistent semantic completion
    // is enforced before a virtualized control is clicked again.
    crawler.expandOne = (targetTurnId = '') => {
      const candidateTurns = targetTurnId
        ? turns().filter(section => section.getAttribute('data-testid') === targetTurnId)
        : turns();

      for (const section of candidateTurns) {
        for (const details of section.querySelectorAll('details:not([open])')) {
          const id = turnId(details);
          const logicalKey = logicalDetailsKey(details);
          if (!logicalActionable(logicalKey, id)) continue;
          const revisionBefore = turnRevision(id);
          details.open = true;
          crawler.state.successfulExpansions++;
          crawler.state.lastExpansionTurn = id;
          crawler.state.lastExpansion = `${id} — opened native <details>`;
          return { kind: 'details', logicalKey, turnId: id, turnRevisionBefore: revisionBefore, description: crawler.state.lastExpansion };
        }
      }

      for (const section of candidateTurns) {
        for (const element of section.querySelectorAll('[aria-expanded="false"]')) {
          if (!isDisclosureControl(element)) continue;
          const key = keyFor(element);
          const attempts = crawler.state.attempts[key] || 0;
          if (attempts >= 3) continue;
          const id = turnId(element);
          const logicalKey = logicalControlKey(element);
          if (!logicalActionable(logicalKey, id)) continue;
          const revisionBefore = turnRevision(id);
          crawler.state.attempts[key] = attempts + 1;
          const shortLabel = label(element).slice(0, 180) || element.getAttribute('aria-controls') || 'unlabelled disclosure';
          crawler.state.lastExpansionTurn = id;
          crawler.state.lastExpansion = `${id} — ${shortLabel}`;
          const controls = element.getAttribute('aria-controls') || '';
          try {
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            element.click();
            crawler.state.clickCount++;
          } catch (error) {
            crawler.state.failures[key] = `${shortLabel}: ${error?.message || 'click failed'}`;
          }
          return { kind: 'click', key, logicalKey, controls, turnId: id, turnRevisionBefore: revisionBefore, description: crawler.state.lastExpansion };
        }
      }
      return null;
    };

    crawler.state.expansionGeneration = Number(crawler.state.expansionGeneration || 0);
    crawler.state.quiescence = { rounds: 0, requiredRounds, lastSignature: '', converged: false, scopeTurnId: '', timedOut: false };
    crawler.state.reconciliation = { converged: null, rounds: 0, stablePasses: 0 };

    crawler.noteExpansionGeneration = scopeTurnId => {
      crawler.state.expansionGeneration++;
      crawler.state.quiescence = { ...crawler.state.quiescence, rounds: 0, lastSignature: '', converged: false, scopeTurnId: scopeTurnId || '', timedOut: false };
    };
    crawler.markQuiescence = value => { crawler.state.quiescence = { ...crawler.state.quiescence, ...value }; };
    crawler.markReconciliation = value => { crawler.state.reconciliation = { ...crawler.state.reconciliation, ...value }; };
    crawler.turnDisclosureSample = turnDisclosureSample;
    crawler.mountedDisclosureSample = mountedDisclosureSample;
    crawler.retainedDisclosureSummary = retainedDisclosureSummary;

    const baseStats = crawler.stats.bind(crawler);
    crawler.stats = () => {
      const collapsed = mountedDisclosureState();
      const retained = retainedDisclosureSummary();
      return {
        ...baseStats(), ...collapsed,
        retainedRevision: Number(crawler.state.retainedRevision || 0),
        retainedCorpusFingerprint: retainedCorpusFingerprint(),
        retainedUnresolvedTurns: retained.retainedUnresolvedTurns,
        retainedUnresolvedDisclosures: retained.retainedUnresolvedDisclosures,
        retainedUnresolvedTurnIds: retained.retainedUnresolvedTurnIds,
        expansionGeneration: crawler.state.expansionGeneration,
        quiescentRounds: crawler.state.quiescence.rounds,
        requiredQuiescentRounds: crawler.state.quiescence.requiredRounds,
        quiescenceConverged: crawler.state.quiescence.converged,
        quiescenceScopeTurn: crawler.state.quiescence.scopeTurnId || '',
        quiescenceTimedOut: Boolean(crawler.state.quiescence.timedOut),
        reconciliationConverged: crawler.state.reconciliation.converged,
        reconciliationRounds: crawler.state.reconciliation.rounds,
        reconciliationStablePasses: crawler.state.reconciliation.stablePasses
      };
    };
    crawler.__disclosureStateInstalled = true;
  }, { requiredRounds: TURN_QUIESCENT_REQUIRED_ROUNDS, maxLabels: MAX_UNRECOGNIZED_LABELS });
}
