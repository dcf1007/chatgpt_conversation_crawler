const MAX_DETAIL_KEYS = 80;

function normalizeString(value) {
  return String(value ?? '');
}

function uniqueSorted(values) {
  return [...new Set((values || []).map(normalizeString).filter(Boolean))].sort();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function diagnosticHash(value) {
  const text = typeof value === 'string' ? value : stableJson(value);
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

function mapValue(map, key) {
  return Number(map?.[key] || 0);
}

function changedRevisionIds(previousMap = {}, currentMap = {}) {
  const ids = new Set([...Object.keys(previousMap), ...Object.keys(currentMap)]);
  return [...ids]
    .filter(id => mapValue(previousMap, id) !== mapValue(currentMap, id))
    .sort((left, right) => left.localeCompare(right));
}

function setDifference(left, right) {
  const rightSet = new Set(right || []);
  return uniqueSorted(left).filter(value => !rightSet.has(value));
}

function compactDisclosureByTurn(value) {
  const rows = Array.isArray(value) ? value : [];
  return rows.slice(0, MAX_DETAIL_KEYS).map(row => ({
    turnId: normalizeString(row.turnId),
    turnRevision: Number(row.turnRevision || 0),
    recognizedCollapsed: Number(row.recognizedCollapsed || 0),
    actionableCollapsed: Number(row.actionableCollapsed || 0),
    closedDetails: Number(row.closedDetails || 0),
    recognizedLogicalKeys: uniqueSorted(row.recognizedLogicalKeys).slice(0, MAX_DETAIL_KEYS),
    actionableLogicalKeys: uniqueSorted(row.actionableLogicalKeys).slice(0, MAX_DETAIL_KEYS),
    closedDetailLogicalKeys: uniqueSorted(row.closedDetailLogicalKeys).slice(0, MAX_DETAIL_KEYS)
  }));
}

function semanticSignatureParts(sample) {
  return [
    Number(sample.retainedTurns || 0),
    normalizeString(sample.oldestRetained || 'none'),
    normalizeString(sample.newestRetained || 'none'),
    normalizeString(sample.retainedCorpusFingerprint),
    Number(sample.timelineMarkers || 0)
  ];
}

export function diagnosticSampleSignature(sample = {}) {
  return diagnosticHash({
    stage: sample.stage || '',
    phase: sample.phase || '',
    pass: Number(sample.pass || 0),
    direction: sample.direction || '',
    step: Number(sample.step || 0),
    scrollTop: Math.round(Number(sample.scrollTop || 0)),
    scrollHeight: Math.round(Number(sample.scrollHeight || 0)),
    scrollClient: Math.round(Number(sample.scrollClient || 0)),
    retainedRevision: Number(sample.retainedRevision || 0),
    retainedCorpusFingerprint: sample.retainedCorpusFingerprint || '',
    mountedTurnIds: sample.mountedTurnIds || [],
    retainedTurnIds: sample.retainedTurnIds || [],
    turnRevisionMap: sample.turnRevisionMap || {},
    hydrationConflictTurnIdsFull: sample.hydrationConflictTurnIdsFull || [],
    turnProcessingFailureTurnIdsFull: sample.turnProcessingFailureTurnIdsFull || [],
    hydrationTimeoutTurnIdsFull: sample.hydrationTimeoutTurnIdsFull || [],
    retainedUnresolvedTurnIdsFull: sample.retainedUnresolvedTurnIdsFull || [],
    actionableLogicalKeys: sample.actionableLogicalKeys || [],
    reconciliationConverged: sample.reconciliationConverged,
    manualPhase: sample.manualPhase || '',
    manualStepIndex: Number(sample.manualStepIndex || 0),
    manualInteractionCount: Number(sample.manualInteractionCount || 0)
  });
}

/**
 * Convert a rich page sample into a compact manifest row. Full sets are emitted
 * only on the first row or when that set changes; every row carries a stable
 * hash plus precise deltas relative to the preceding actually-recorded sample.
 */
export function buildManifestMetadata(current = {}, previous = null, { forceDetails = false } = {}) {
  const {
    mountedTurnIds = [],
    retainedTurnIds = [],
    turnRevisionMap = {},
    hydrationConflictTurnIdsFull = [],
    turnProcessingFailureTurnIdsFull = [],
    hydrationTimeoutTurnIdsFull = [],
    retainedUnresolvedTurnIdsFull = [],
    actionableLogicalKeys = [],
    disclosureByTurn = [],
    ...publicFields
  } = current;

  const previousMounted = previous?.mountedTurnIds || [];
  const previousRetained = previous?.retainedTurnIds || [];
  const previousRevisions = previous?.turnRevisionMap || {};
  const previousHydration = previous?.hydrationConflictTurnIdsFull || [];
  const previousFailures = previous?.turnProcessingFailureTurnIdsFull || [];
  const previousTimeouts = previous?.hydrationTimeoutTurnIdsFull || [];
  const previousUnresolved = previous?.retainedUnresolvedTurnIdsFull || [];
  const previousActionable = previous?.actionableLogicalKeys || [];
  const previousDisclosure = previous?.disclosureByTurn || [];

  const currentMounted = uniqueSorted(mountedTurnIds);
  const currentRetained = uniqueSorted(retainedTurnIds);
  const currentHydration = uniqueSorted(hydrationConflictTurnIdsFull);
  const currentFailures = uniqueSorted(turnProcessingFailureTurnIdsFull);
  const currentTimeouts = uniqueSorted(hydrationTimeoutTurnIdsFull);
  const currentUnresolved = uniqueSorted(retainedUnresolvedTurnIdsFull);
  const currentActionable = uniqueSorted(actionableLogicalKeys);
  const currentDisclosure = compactDisclosureByTurn(disclosureByTurn);

  const mountedHash = diagnosticHash(currentMounted);
  const retainedHash = diagnosticHash(currentRetained);
  const revisionHash = diagnosticHash(turnRevisionMap);
  const hydrationHash = diagnosticHash(currentHydration);
  const failureHash = diagnosticHash(currentFailures);
  const timeoutHash = diagnosticHash(currentTimeouts);
  const unresolvedHash = diagnosticHash(currentUnresolved);
  const actionableHash = diagnosticHash(currentActionable);
  const disclosureHash = diagnosticHash(currentDisclosure);
  const semanticHash = diagnosticHash(semanticSignatureParts(current));
  const previousSemanticHash = previous ? diagnosticHash(semanticSignatureParts(previous)) : '';
  const changedTurnIds = previous ? changedRevisionIds(previousRevisions, turnRevisionMap) : currentRetained;

  const details = forceDetails || !previous;
  const mountedChanged = details || mountedHash !== diagnosticHash(uniqueSorted(previousMounted));
  const retainedChanged = details || retainedHash !== diagnosticHash(uniqueSorted(previousRetained));
  const hydrationChanged = details || hydrationHash !== diagnosticHash(uniqueSorted(previousHydration));
  const failuresChanged = details || failureHash !== diagnosticHash(uniqueSorted(previousFailures));
  const timeoutsChanged = details || timeoutHash !== diagnosticHash(uniqueSorted(previousTimeouts));
  const unresolvedChanged = details || unresolvedHash !== diagnosticHash(uniqueSorted(previousUnresolved));
  const actionableChanged = details || actionableHash !== diagnosticHash(uniqueSorted(previousActionable));
  const disclosureChanged = details || disclosureHash !== diagnosticHash(compactDisclosureByTurn(previousDisclosure));

  return {
    ...publicFields,
    diagnosticSchemaVersion: 2,
    semanticSignatureHash: semanticHash,
    semanticChangedSincePreviousCapture: previous ? semanticHash !== previousSemanticHash : null,
    mountedTurnIdsHash: mountedHash,
    retainedTurnIdsHash: retainedHash,
    turnRevisionMapHash: revisionHash,
    hydrationConflictTurnIdsHash: hydrationHash,
    turnProcessingFailureTurnIdsHash: failureHash,
    hydrationTimeoutTurnIdsHash: timeoutHash,
    retainedUnresolvedTurnIdsHash: unresolvedHash,
    actionableLogicalKeysHash: actionableHash,
    disclosureStateHash: disclosureHash,
    changedTurnIds,
    changedTurnRevisions: changedTurnIds.map(turnId => ({
      turnId,
      from: previous ? mapValue(previousRevisions, turnId) : null,
      to: mapValue(turnRevisionMap, turnId)
    })),
    newlyRetainedTurnIds: previous ? setDifference(currentRetained, previousRetained) : currentRetained,
    noLongerRetainedTurnIds: previous ? setDifference(previousRetained, currentRetained) : [],
    newHydrationConflictTurnIds: previous ? setDifference(currentHydration, previousHydration) : currentHydration,
    resolvedHydrationConflictTurnIds: previous ? setDifference(previousHydration, currentHydration) : [],
    newTurnProcessingFailureTurnIds: previous ? setDifference(currentFailures, previousFailures) : currentFailures,
    newHydrationTimeoutTurnIds: previous ? setDifference(currentTimeouts, previousTimeouts) : currentTimeouts,
    newUnresolvedTurnIds: previous ? setDifference(currentUnresolved, previousUnresolved) : currentUnresolved,
    resolvedUnresolvedTurnIds: previous ? setDifference(previousUnresolved, currentUnresolved) : [],
    mountedTurnIds: mountedChanged ? currentMounted : undefined,
    retainedTurnIds: retainedChanged ? currentRetained : undefined,
    hydrationConflictTurnIdsFull: hydrationChanged ? currentHydration : undefined,
    turnProcessingFailureTurnIdsFull: failuresChanged ? currentFailures : undefined,
    hydrationTimeoutTurnIdsFull: timeoutsChanged ? currentTimeouts : undefined,
    retainedUnresolvedTurnIdsFull: unresolvedChanged ? currentUnresolved : undefined,
    actionableLogicalKeys: actionableChanged ? currentActionable.slice(0, MAX_DETAIL_KEYS) : undefined,
    actionableLogicalKeysTruncated: actionableChanged ? currentActionable.length > MAX_DETAIL_KEYS : undefined,
    disclosureByTurn: disclosureChanged ? currentDisclosure : undefined,
    disclosureByTurnTruncated: disclosureChanged ? disclosureByTurn.length > MAX_DETAIL_KEYS : undefined
  };
}
