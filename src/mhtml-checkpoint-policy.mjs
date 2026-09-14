function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function string(value) {
  return String(value || '');
}

function sortedStrings(values) {
  return [...new Set((values || []).map(value => String(value || '')).filter(Boolean))].sort();
}

function sameStringSet(left, right) {
  const leftValues = sortedStrings(left);
  const rightValues = sortedStrings(right);
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function targetDisclosureChanged(previous, current) {
  const targetTurnId = string(current.activeTurnId);
  if (!targetTurnId || targetTurnId !== string(previous.activeTurnId)) return false;

  if (!sameStringSet(previous.activeTurnActionableLogicalKeys, current.activeTurnActionableLogicalKeys)) return true;
  if (number(previous.activeTurnActionableCollapsed) !== number(current.activeTurnActionableCollapsed)) return true;
  if (number(previous.activeTurnRecognizedCollapsed) !== number(current.activeTurnRecognizedCollapsed)) return true;
  if (number(previous.activeTurnClosedDetails) !== number(current.activeTurnClosedDetails)) return true;
  return false;
}

/**
 * Decide whether a lightweight diagnostic transition needs a full DOM forensic
 * checkpoint. Physical scroll/mount/viewport changes are intentionally absent:
 * they remain useful JSONL telemetry but must never trigger MHTML by themselves.
 *
 * The policy is deliberately narrow. It keeps MHTML around transitions where
 * seeing the live DOM can explain a crawler/fidelity failure, while ordinary
 * virtualizer motion and progress bookkeeping stay inexpensive.
 */
export function selectMhtmlCheckpointReason(previous = null, current = null) {
  if (!previous || !current) return '';

  if (number(previous.turnProcessingFailures) !== number(current.turnProcessingFailures)) {
    return 'turn-processing-state-change';
  }

  if (number(previous.hydrationTimeoutEvents) !== number(current.hydrationTimeoutEvents)) {
    return 'hydration-timeout-state-change';
  }

  if (number(previous.hydrationConflictsUnresolved) !== number(current.hydrationConflictsUnresolved)) {
    return 'hydration-conflict-state-change';
  }

  if (targetDisclosureChanged(previous, current)) {
    return 'target-disclosure-state-change';
  }

  const resourceCountIncreased =
    number(current.images) > number(previous.images) ||
    number(current.appBlocks) > number(previous.appBlocks) ||
    number(current.iframes) > number(previous.iframes);
  const retainedSemanticStateAdvanced =
    number(current.retainedRevision) > number(previous.retainedRevision) ||
    number(current.retainedTurns) > number(previous.retainedTurns);
  if (resourceCountIncreased && retainedSemanticStateAdvanced) {
    return 'archive-resource-state-change';
  }

  return '';
}

/**
 * A compact signature used only by tests and diagnostics to prove that the MHTML
 * policy excludes physical viewport/topology churn. It is intentionally much
 * narrower than diagnosticSampleSignature(), which remains the telemetry wakeup
 * signature.
 */
export function mhtmlCheckpointSignature(sample = {}) {
  return JSON.stringify({
    turnProcessingFailures: number(sample.turnProcessingFailures),
    hydrationTimeoutEvents: number(sample.hydrationTimeoutEvents),
    hydrationConflictsUnresolved: number(sample.hydrationConflictsUnresolved),
    activeTurnId: string(sample.activeTurnId),
    activeTurnActionableLogicalKeys: sortedStrings(sample.activeTurnActionableLogicalKeys),
    activeTurnActionableCollapsed: number(sample.activeTurnActionableCollapsed),
    activeTurnRecognizedCollapsed: number(sample.activeTurnRecognizedCollapsed),
    activeTurnClosedDetails: number(sample.activeTurnClosedDetails),
    images: number(sample.images),
    appBlocks: number(sample.appBlocks),
    iframes: number(sample.iframes),
    retainedRevision: number(sample.retainedRevision),
    retainedTurns: number(sample.retainedTurns)
  });
}
