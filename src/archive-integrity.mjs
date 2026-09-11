const MAX_LISTED_TURNS = 20;

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function turnList(value) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, MAX_LISTED_TURNS) : [];
}

export function evaluateArchiveIntegrity(stats = {}) {
  const warnings = [];

  const missingTurns = numeric(stats.seenMountedUnretainedTurns);
  if (missingTurns > 0) {
    const ids = turnList(stats.seenMountedUnretainedTurnIds);
    warnings.push({
      code: 'observed-turns-not-retained',
      count: missingTurns,
      turnIds: ids,
      message: `${missingTurns} mounted conversation turn(s) were observed but do not have a retained archive candidate.`
    });
  }

  const scanLimits = numeric(stats.scanLimitEvents);
  if (scanLimits > 0) {
    warnings.push({
      code: 'traversal-not-converged',
      count: scanLimits,
      message: `${scanLimits} traversal pass(es) reached their safety limit before endpoint convergence was proven.`
    });
  }

  if (stats.oldestConverged === false) {
    warnings.push({
      code: 'oldest-edge-not-converged',
      count: 1,
      message: `Oldest-message verification stopped at its safety limit after ${numeric(stats.oldestChecks)} check(s).`
    });
  }

  const unresolvedDisclosures = numeric(stats.retainedUnresolvedDisclosures);
  if (unresolvedDisclosures > 0) {
    warnings.push({
      code: 'retained-disclosures-unresolved',
      count: unresolvedDisclosures,
      turnIds: turnList(stats.retainedUnresolvedTurnIds),
      message: `${numeric(stats.retainedUnresolvedTurns)} retained turn(s) still contain ${unresolvedDisclosures} recognized unresolved disclosure(s).`
    });
  }

  const expansionLimits = numeric(stats.expansionLimitEvents);
  if (expansionLimits > 0) {
    warnings.push({
      code: 'expansion-limit-reached',
      count: expansionLimits,
      message: `${expansionLimits} disclosure-expansion sweep(s) reached their action safety limit.`
    });
  }

  const hydrationTimeouts = numeric(stats.hydrationTimeoutEvents);
  if (hydrationTimeouts > 0) {
    warnings.push({
      code: 'hydration-timeout',
      count: hydrationTimeouts,
      turnIds: turnList(stats.hydrationTimeoutTurnIds),
      message: `${hydrationTimeouts} hydration/quiescence wait(s) reached their safety timeout.`
    });
  }

  const unresolvedHydration = numeric(stats.hydrationConflictsUnresolved);
  if (unresolvedHydration > 0) {
    warnings.push({
      code: 'hydration-conflict-unresolved',
      count: unresolvedHydration,
      turnIds: turnList(stats.hydrationConflictTurnIds),
      message: `${unresolvedHydration} turn(s) retained content from competing hydration generations because no single observed generation covered the complete retained union.`
    });
  }

  return {
    status: warnings.length ? 'warning' : 'verified',
    verifiedComplete: warnings.length === 0,
    warningCount: warnings.length,
    warnings,
    hydrationConflictsResolved: numeric(stats.hydrationConflictsResolved),
    hydrationConflictsUnresolved: unresolvedHydration
  };
}
