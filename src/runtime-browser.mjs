import { chromium } from 'playwright';
import { installChromiumBackgroundProtection } from './chromium-background-protection.mjs';

const foregroundSessions = new WeakMap();

// Permanent capture behavior: keep Chromium's renderer/timer/background-window
// throttles disabled for headed authenticated capture contexts.
installChromiumBackgroundProtection(chromium);

async function applyForegroundState(session) {
  const result = {
    focusEmulation: false,
    idleOverride: false,
    lifecycleActive: false
  };

  try {
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    result.focusEmulation = true;
  } catch {}
  try {
    await session.send('Emulation.setIdleOverride', { isUserActive: true, isScreenUnlocked: true });
    result.idleOverride = true;
  } catch {}
  try {
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    result.lifecycleActive = true;
  } catch {}

  return result;
}

function foregroundStateApplied(result) {
  return Boolean(result?.focusEmulation || result?.idleOverride || result?.lifecycleActive);
}

async function sampleForegroundState(page) {
  return page.evaluate(() => ({
    hasFocus: Boolean(document.hasFocus?.()),
    visibilityState: document.visibilityState || '',
    hidden: Boolean(document.hidden)
  })).catch(() => ({ hasFocus: null, visibilityState: '', hidden: null }));
}

async function createProtectedSession(page) {
  const context = page?.context?.();
  if (!context?.newCDPSession) return { session: null, applied: null };
  const session = await context.newCDPSession(page);
  const applied = await applyForegroundState(session);
  if (!foregroundStateApplied(applied)) {
    await session.detach?.().catch(() => {});
    return { session: null, applied };
  }
  foregroundSessions.set(page, session);
  return { session, applied };
}

async function installFocusTelemetry(page) {
  return page.evaluate(() => {
    if (!window.__archiveFocusTelemetry) {
      const telemetry = window.__archiveFocusTelemetry = {
        focusEvents: 0,
        blurEvents: 0,
        visibilityChanges: 0,
        lastEvent: '',
        lastEventAt: ''
      };
      const record = type => {
        if (type === 'focus') telemetry.focusEvents++;
        else if (type === 'blur') telemetry.blurEvents++;
        else if (type === 'visibilitychange') telemetry.visibilityChanges++;
        telemetry.lastEvent = type;
        telemetry.lastEventAt = new Date().toISOString();
      };
      window.addEventListener('focus', () => record('focus'), true);
      window.addEventListener('blur', () => record('blur'), true);
      document.addEventListener('visibilitychange', () => record('visibilitychange'), true);
    }
    return {
      hasFocus: Boolean(document.hasFocus?.()),
      visibilityState: document.visibilityState || '',
      hidden: Boolean(document.hidden)
    };
  }).catch(() => ({ hasFocus: null, visibilityState: '', hidden: null }));
}

/**
 * Install non-window-activating Chromium activity protection on the capture
 * page. CDP overrides remain best-effort, but a session is only cached when at
 * least one override was actually accepted.
 */
export async function installPageForegroundProtection(page) {
  if (!page?.context || typeof page.context !== 'function') return false;
  if (foregroundSessions.has(page)) return false;

  const before = await installFocusTelemetry(page);
  let created;
  try {
    created = await createProtectedSession(page);
  } catch {
    return false;
  }
  if (!created.session) return false;

  const after = await sampleForegroundState(page);
  await page.evaluate(value => {
    window.__archiveForegroundProtection = {
      ...value.applied,
      installedAt: new Date().toISOString(),
      reassertions: 0,
      sessionRecoveries: 0,
      lastReassertedAt: '',
      preInstallHasFocus: value.before.hasFocus,
      preInstallVisibilityState: value.before.visibilityState,
      preInstallHidden: value.before.hidden,
      postInstallHasFocus: value.after.hasFocus,
      postInstallVisibilityState: value.after.visibilityState,
      postInstallHidden: value.after.hidden
    };
  }, { before, after, applied: created.applied }).catch(() => {});
  return true;
}

/**
 * Reassert activity protection. If the cached CDP session has become stale,
 * discard it and create one fresh session exactly once. No recovery path calls
 * Page.bringToFront or otherwise activates the native browser window.
 */
export async function ensurePageForegroundProtection(page) {
  if (!page) return false;
  if (!foregroundSessions.has(page)) return installPageForegroundProtection(page);

  let session = foregroundSessions.get(page);
  let applied = await applyForegroundState(session);
  let recovered = false;

  if (!foregroundStateApplied(applied)) {
    foregroundSessions.delete(page);
    await session?.detach?.().catch(() => {});
    let created;
    try {
      created = await createProtectedSession(page);
    } catch {
      return false;
    }
    if (!created.session) return false;
    session = created.session;
    applied = created.applied;
    recovered = true;
  }

  const after = await sampleForegroundState(page);
  await page.evaluate(value => {
    const previous = window.__archiveForegroundProtection || {};
    window.__archiveForegroundProtection = {
      ...previous,
      ...value.applied,
      reassertions: Number(previous.reassertions || 0) + 1,
      sessionRecoveries: Number(previous.sessionRecoveries || 0) + (value.recovered ? 1 : 0),
      lastReassertedAt: new Date().toISOString(),
      postInstallHasFocus: value.after.hasFocus,
      postInstallVisibilityState: value.after.visibilityState,
      postInstallHidden: value.after.hidden
    };
  }, { applied, after, recovered }).catch(() => {});
  return true;
}

export { chromium };
