export const TURN_QUIESCENT_REQUIRED_ROUNDS = 3;
export const MAX_UNRECOGNIZED_LABELS = 12;

/** Add beta8 disclosure diagnostics to the already-installed page crawler. */
export async function installBeta8Diagnostics(page) {
  await page.evaluate(({ requiredRounds, maxLabels }) => {
    const crawler = window.__archiveCrawler;
    if (!crawler || crawler.__beta8DiagnosticsInstalled) return;

    const turnSelector = 'section[data-testid^="conversation-turn-"]';
    const turns = () => [...document.querySelectorAll(turnSelector)];
    const label = element => [element.getAttribute('aria-label'), element.textContent, element.getAttribute('title')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const turnId = element => element.closest(turnSelector)?.getAttribute('data-testid') || 'unknown-turn';
    const turnNumber = id => Number(/conversation-turn-(\d+)/.exec(id || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    const keyFor = element => [turnId(element), element.getAttribute('aria-controls') || '', label(element).slice(0, 240)].join('|');

    function isRecognizedDisclosure(element) {
      if (!(element instanceof HTMLElement) || element.getAttribute('aria-expanded') !== 'false') return false;
      if (element.matches('[aria-haspopup],[role="menuitem"]')) return false;
      if (element.getAttribute('aria-controls')) return true;
      return /^(worked for|thought(?: for)?|thinking(?: for)?|reasoning(?: for)?)\b/i.test(label(element));
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

    function sectionDiagnostics(section) {
      const collapsed = [...section.querySelectorAll('[aria-expanded="false"]')];
      const recognizedKeys = [];
      const actionableKeys = [];
      for (const element of collapsed) {
        if (!isRecognizedDisclosure(element)) continue;
        const key = keyFor(element);
        recognizedKeys.push(key);
        if (Number(crawler.state?.attempts?.[key] || 0) < 3) actionableKeys.push(key);
      }
      recognizedKeys.sort();
      actionableKeys.sort();
      return {
        allCollapsedControls: collapsed.length,
        recognizedCollapsed: recognizedKeys.length,
        actionableCollapsed: actionableKeys.length,
        closedDetails: section.querySelectorAll('details:not([open])').length,
        recognizedKeys,
        actionableKeys
      };
    }

    function collapsedDiagnostics() {
      let allCollapsedControls = 0;
      let recognizedCollapsed = 0;
      let actionableCollapsed = 0;
      let closedDetails = 0;
      const unrecognizedCollapsedLabels = [];

      for (const section of turns()) {
        const diagnostics = sectionDiagnostics(section);
        allCollapsedControls += diagnostics.allCollapsedControls;
        recognizedCollapsed += diagnostics.recognizedCollapsed;
        actionableCollapsed += diagnostics.actionableCollapsed + diagnostics.closedDetails;
        closedDetails += diagnostics.closedDetails;

        if (unrecognizedCollapsedLabels.length >= maxLabels) continue;
        for (const element of section.querySelectorAll('[aria-expanded="false"]')) {
          if (isRecognizedDisclosure(element)) continue;
          const text = label(element).slice(0, 180) || element.tagName?.toLowerCase?.() || 'unlabelled control';
          unrecognizedCollapsedLabels.push(`${turnId(element)} — ${text}`);
          if (unrecognizedCollapsedLabels.length >= maxLabels) break;
        }
      }
      return { allCollapsedControls, recognizedCollapsed, actionableCollapsed, closedDetails, unrecognizedCollapsedLabels };
    }

    // Only this turn participates in disclosure quiescence. Unrelated mounted
    // turns are intentionally excluded so virtualizer boundary churn is noise.
    function turnDisclosureSample(targetTurnId) {
      const section = turns().find(turn => turn.getAttribute('data-testid') === targetTurnId);
      if (!section) {
        return { mounted: false, turnId: targetTurnId, actionableCollapsed: 0, recognizedCollapsed: 0, closedDetails: 0, signature: `missing:${targetTurnId}` };
      }
      const metrics = sampleNode(section);
      const diagnostics = sectionDiagnostics(section);
      return {
        mounted: true,
        turnId: targetTurnId,
        ...metrics,
        ...diagnostics,
        signature: [
          targetTurnId,
          metrics.textLength, metrics.htmlLength, metrics.preCount, metrics.codeCount, metrics.mediaCount, metrics.childCount,
          diagnostics.recognizedCollapsed, diagnostics.actionableCollapsed, diagnostics.closedDetails,
          diagnostics.recognizedKeys.join('~'), diagnostics.actionableKeys.join('~')
        ].join('|')
      };
    }

    // Before a turn becomes active, sample disclosure identities only. Plain
    // messages mounting/unmounting do not alter this signature.
    function mountedDisclosureSample() {
      const parts = [];
      let recognizedCollapsed = 0;
      let actionableCollapsed = 0;
      let closedDetails = 0;
      for (const section of turns()) {
        const id = section.getAttribute('data-testid') || '';
        const diagnostics = sectionDiagnostics(section);
        recognizedCollapsed += diagnostics.recognizedCollapsed;
        actionableCollapsed += diagnostics.actionableCollapsed + diagnostics.closedDetails;
        closedDetails += diagnostics.closedDetails;
        if (diagnostics.recognizedCollapsed || diagnostics.closedDetails) {
          parts.push([id, diagnostics.recognizedKeys.join('~'), diagnostics.actionableKeys.join('~'), diagnostics.closedDetails].join(':'));
        }
      }
      parts.sort();
      return { recognizedCollapsed, actionableCollapsed, closedDetails, signature: parts.join('|') };
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
          Number(turn.textLength || 0), Number(turn.htmlLength || turn.html?.length || 0)
        ].join(':')).join('|')
      };
    }

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
      const collapsed = collapsedDiagnostics();
      const retained = retainedDisclosureSummary();
      return {
        ...baseStats(), ...collapsed,
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
    crawler.__beta8DiagnosticsInstalled = true;
  }, { requiredRounds: TURN_QUIESCENT_REQUIRED_ROUNDS, maxLabels: MAX_UNRECOGNIZED_LABELS });
}
