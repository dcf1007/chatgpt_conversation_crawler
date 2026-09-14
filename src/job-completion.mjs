export function archiveJobCleanupComplete(job = {}) {
  return !job.page && !job.context && !job.browser && !job.authenticatedHandle;
}

/**
 * The final HTML may be assembled before Playwright and development diagnostics
 * have finished closing. Keep that internal state private: callers should see a
 * job as complete only after all browser/session ownership has been released.
 */
export function publicArchiveJobLifecycle(job = {}) {
  if (job.state === 'complete' && !archiveJobCleanupComplete(job)) {
    return {
      status: 'running',
      stage: 'finalization',
      phase: 'Closing browser session',
      detail: 'Final archive assembled; waiting for browser and diagnostic cleanup before enabling download.'
    };
  }

  return {
    status: job.state === 'complete' ? 'done' : job.state,
    stage: job.stage || 'queued',
    phase: job.phase || '',
    detail: job.detail || ''
  };
}
