import {
  reconcileRetainedDisclosures,
  runAutomaticTraversal,
  scan
} from './crawler-traversal.mjs';
import { processTurnToFixedPoint, retainedTurnIds } from './crawler-turn-processing.mjs';
import { sealTransientContextRetention } from './transient-context-retention.mjs';

const FINAL_RECOVERY_MAX_EPOCHS = 2;

async function revisionMap(page) {
  return page.evaluate(() => Object.fromEntries(
    Object.keys(window.__archiveCrawler?.state?.turns || {}).map(turnId => [
      turnId,
      Number(window.__archiveCrawler.turnRevision?.(turnId) || 0)
    ])
  ));
}

function changedTurnIds(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...ids].filter(turnId => Number(before?.[turnId] ?? -1) !== Number(after?.[turnId] ?? -1));
}

async function currentRecoveryTargets(page) {
  return page.evaluate(() => {
    const crawler = window.__archiveCrawler;
    const failed = crawler.currentFailedTurnIds?.() || Object.entries(crawler.state?.turnProcessingResults || {})
      .filter(([, result]) => result?.converged === false)
      .map(([turnId]) => turnId);
    const disclosure = crawler.retainedDisclosureSummary?.() || {};
    const unresolved = Array.isArray(disclosure.retainedUnresolvedTurnIdsFull)
      ? disclosure.retainedUnresolvedTurnIdsFull
      : disclosure.retainedUnresolvedTurnIds || [];
    const order = turnId => Number(/conversation-turn-(\d+)/.exec(turnId || '')?.[1] ?? Number.MAX_SAFE_INTEGER);
    return [...new Set([...failed, ...unresolved])]
      .sort((left, right) => order(left) - order(right) || left.localeCompare(right));
  });
}

async function emit(page, onProgress, patch) {
  const stats = await page.evaluate(() => window.__archiveCrawler.stats());
  const metrics = await page.evaluate(() => window.__archiveCrawler.metrics());
  await onProgress?.({
    ...stats,
    scrollTop: Number(metrics.top || 0),
    scrollHeight: Number(metrics.height || 0),
    scrollClient: Number(metrics.client || 0),
    ...patch
  });
}

async function processRecoveryTargets(page, turnIds, epoch, onProgress, shouldCancel, turnProcessing) {
  const retained = await retainedTurnIds(page);
  const retainedSet = new Set(retained);
  const records = [];

  for (const turnId of turnIds) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    if (!retainedSet.has(turnId)) continue;

    await page.evaluate(id => {
      const crawler = window.__archiveCrawler;
      crawler.resetTurnPhysicalDisclosureAttempts?.(id);
    }, turnId);

    const beforeRevision = await page.evaluate(id => Number(window.__archiveCrawler.turnRevision?.(id) || 0), turnId);
    await emit(page, onProgress, {
      stage: 'targeted_revalidation',
      phase: 'Beta4 targeted semantic revalidation',
      detail: `Rebuilding the fixed-point certificate for ${turnId} after a fresh remount challenge.`,
      scanningStatus: `${turnId} · recovery epoch ${epoch}/${FINAL_RECOVERY_MAX_EPOCHS}`,
      scanComplete: false,
      pass: 0,
      direction: '',
      step: 0
    });

    const result = await processTurnToFixedPoint(page, turnId, await retainedTurnIds(page), {
      shouldCancel,
      onProgress
    });
    const afterRevision = await page.evaluate(id => Number(window.__archiveCrawler.turnRevision?.(id) || 0), turnId);
    const marked = {
      turnId,
      ...result,
      recoveryEpoch: epoch,
      revisionBeforeRecovery: beforeRevision,
      revisionAfterRecovery: afterRevision
    };
    await page.evaluate(value => window.__archiveCrawler.markTurnProcessingResult?.(value), marked);
    turnProcessing.push(marked);
    records.push(marked);
  }
  return records;
}

function baseConvergenceIsRecoverable(baseResult) {
  return Boolean(
    Array.isArray(baseResult?.scans)
    && baseResult.scans.every(result => result?.converged)
    && baseResult?.oldest?.converged
  );
}

/**
 * Beta4 closure controller. Beta3 remains the authoritative discovery/coverage
 * engine. This layer adds the missing post-remount recovery epoch proved by the
 * 60-turn regression, then certifies the repaired corpus again if it changed.
 */
export async function runBeta4Traversal(page, { onProgress, shouldCancel } = {}) {
  const proxyProgress = async patch => {
    if (patch?.stage === 'finalization' && patch?.scanComplete === true) {
      return onProgress?.({
        ...patch,
        stage: 'recovery_preparation',
        phase: 'Initial semantic closure complete — checking beta4 recovery invariants',
        detail: 'The beta3 fixed point has been reached. Beta4 is now checking current failed turns and stale logical disclosure proof after a fresh remount epoch.',
        scanComplete: false
      });
    }
    return onProgress?.(patch);
  };

  await emit(page, onProgress, {
    stage: 'preparing',
    phase: 'Preparing beta4 semantic crawler',
    detail: 'Preparing beta3 bidirectional semantic traversal plus beta4 failed-turn recovery, passive-retention sealing, and final closure certification.',
    scanningStatus: 'Not started',
    scanComplete: false,
    pass: 0,
    direction: '',
    step: 0
  });

  const baseResult = await runAutomaticTraversal(page, {
    onProgress: proxyProgress,
    shouldCancel
  });
  const scans = [...(baseResult.scans || [])];
  const turnProcessing = [...(baseResult.turnProcessing || [])];

  const transient = await sealTransientContextRetention(page).catch(() => ({ installed: false, sealed: false, captures: 0 }));
  await page.evaluate(value => {
    if (window.__archiveCrawler?.state) window.__archiveCrawler.state.beta4TransientRetentionSealed = Boolean(value?.sealed || !value?.installed);
    window.__archiveCrawler?.captureTimelineMarkers?.();
  }, transient).catch(() => {});

  let finalReconciliation = baseResult.reconciliation;
  const recoveryEpochs = [];
  let needChallenge = (await currentRecoveryTargets(page)).length > 0;
  let direction = 'up';

  for (let epoch = 1; epoch <= FINAL_RECOVERY_MAX_EPOCHS && needChallenge; epoch++) {
    if (shouldCancel?.()) throw new Error('Archive cancelled.');
    const verificationEpoch = await page.evaluate(() => window.__archiveCrawler.beginBeta4VerificationEpoch?.() || 0);
    const beforeChallenge = await revisionMap(page);
    const phase = epoch === 1 ? 'Final failed-turn remount challenge' : 'Post-repair closure verification';

    const challenge = await scan(
      page,
      direction,
      3 + epoch,
      patch => onProgress?.({
        ...patch,
        stage: 'recovery_verification',
        phase,
        detail: epoch === 1
          ? 'Passively remounting the corpus before retrying current failed or unresolved turns.'
          : 'Passively challenging the repaired corpus from the opposite direction before final certification.',
        scanComplete: false
      }),
      shouldCancel
    );
    challenge.phase = phase;
    challenge.recoveryEpoch = epoch;
    scans.push(challenge);

    const afterChallenge = await revisionMap(page);
    const currentTargets = await currentRecoveryTargets(page);
    const dirty = [...new Set([
      ...currentTargets,
      ...changedTurnIds(beforeChallenge, afterChallenge)
    ])];
    const retained = new Set(await retainedTurnIds(page));
    const orderedDirty = (await retainedTurnIds(page)).filter(turnId => retained.has(turnId) && dirty.includes(turnId));

    const records = await processRecoveryTargets(page, orderedDirty, epoch, onProgress, shouldCancel, turnProcessing);
    const afterProcessing = await revisionMap(page);
    const semanticProgress = changedTurnIds(beforeChallenge, afterProcessing).length > 0;

    finalReconciliation = await reconcileRetainedDisclosures(page, onProgress, shouldCancel);
    const remaining = await currentRecoveryTargets(page);
    recoveryEpochs.push({
      epoch,
      verificationEpoch,
      direction,
      challengeConverged: Boolean(challenge.converged),
      dirtyTurnIds: orderedDirty,
      processed: records.length,
      semanticProgress,
      remainingTurnIds: remaining
    });

    needChallenge = semanticProgress;
    if (!remaining.length && !semanticProgress) break;
    if (remaining.length && !semanticProgress) break;
    direction = direction === 'up' ? 'down' : 'up';
  }

  finalReconciliation = await reconcileRetainedDisclosures(page, onProgress, shouldCancel);
  const finalStats = await page.evaluate(() => window.__archiveCrawler.stats());
  const recoveryScansConverged = scans.every(result => result?.converged);
  const traversalConverged = baseConvergenceIsRecoverable(baseResult)
    && recoveryScansConverged
    && Number(finalStats.turnProcessingFailures || 0) === 0
    && Number(finalStats.retainedUnresolvedDisclosures || 0) === 0
    && Boolean(finalReconciliation?.converged)
    && Boolean(finalStats.mountRetentionSealed)
    && Boolean(finalStats.beta4TransientRetentionSealed);

  const parts = [
    recoveryScansConverged ? 'all passive corpus challenges converged' : 'one or more passive corpus challenges reached a safety limit',
    finalStats.turnProcessingFailures ? `${finalStats.turnProcessingFailures} current turn-processing failure(s) remain` : 'no current turn-processing failures remain',
    finalStats.retainedUnresolvedDisclosures ? `${finalStats.retainedUnresolvedDisclosures} actionable logical disclosure(s) remain` : 'logical disclosure proof is current',
    finalStats.beta4TransientRetentionSealed ? 'passive transient retention sealed' : 'transient retention was not proven sealed'
  ];

  await emit(page, onProgress, {
    stage: 'finalization',
    phase: traversalConverged
      ? 'Turn/corpus convergence complete'
      : 'Turn/corpus processing finished with integrity warnings',
    detail: traversalConverged
      ? 'Bidirectional passive discovery, guarded turn-local processing, revision-scoped disclosure proof, failed-turn recovery, closure verification, and passive-retention sealing reached the required fixed point.'
      : 'Beta4 completed bounded recovery and closure checks, but one or more current convergence invariants remain unproved. Retained content will be finalized with integrity warnings.',
    scanningStatus: parts.join('; '),
    scanComplete: true,
    pass: 0,
    direction: '',
    step: 0,
    previewPaused: false
  });

  return {
    ...baseResult,
    scans,
    reconciliation: finalReconciliation,
    turnProcessing,
    recoveryEpochs,
    transientRetention: transient,
    finalExpansion: {
      converged: Boolean(finalReconciliation?.converged) && Number(finalStats.retainedUnresolvedDisclosures || 0) === 0,
      processed: recoveryEpochs.reduce((total, epoch) => total + Number(epoch.processed || 0), 0),
      reason: finalReconciliation?.converged ? 'beta4-logical-disclosure-fixed-point' : 'beta4-logical-disclosure-unresolved'
    },
    traversalConverged
  };
}

export const __testing = {
  changedTurnIds,
  baseConvergenceIsRecoverable
};
