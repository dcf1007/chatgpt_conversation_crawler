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
    lifecycleActive: false,
    pageActivated: false
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
  try {
    await session.send('Page.bringToFront');
    result.pageActivated = true;
  } catch {}

  return result;
}

async function sampleForegroundState(page) {
  return page.evaluate(() => ({
    hasFocus: Boolean(document.hasFocus?.()),
    visibilityState: document.visibilityState || '',
    hidden: Boolean(document.hidden)
  })).catch(() => ({ hasFocus: null, visibilityState: '', hidden: null }));
}

/**
 * Install persistent Chromium page-activity protection on the capture page.
 * This is core crawler behavior, not diagnostic behavior. The CDP overrides are
 * best-effort so older Chromium builds can still crawl with the launch flags.
 */
export async function installPageForegroundProtection(page) {
  if (!page?.context || typeof page.context !== 'function') return false;
  if (foregroundSessions.has(page)) return false;
  const context = page.context();
  if (!context?.newCDPSession) return false;

  const before = await page.evaluate(() => {
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

  const session = await context.newCDPSession(page);
  foregroundSessions.set(page, session);
  const applied = await applyForegroundState(session);
  const after = await sampleForegroundState(page);

  await page.evaluate(value => {
    window.__archiveForegroundProtection = {
      ...value.applied,
      installedAt: new Date().toISOString(),
      reassertions: 0,
      lastReassertedAt: '',
      preInstallHasFocus: value.before.hasFocus,
      preInstallVisibilityState: value.before.visibilityState,
      preInstallHidden: value.before.hidden,
      postInstallHasFocus: value.after.hasFocus,
      postInstallVisibilityState: value.after.visibilityState,
      postInstallHidden: value.after.hidden
    };
  }, { before, after, applied }).catch(() => {});
  return true;
}

/**
 * Reassert the activity overrides on an existing capture page. Automatic
 * traversal invokes this at scan boundaries and again after genuine logical
 * navigation stagnation, so one transient Chromium/background state change
 * cannot silently disable the protection for the rest of a long crawl.
 */
export async function ensurePageForegroundProtection(page) {
  if (!page) return false;
  if (!foregroundSessions.has(page)) return installPageForegroundProtection(page);
  const session = foregroundSessions.get(page);
  const applied = await applyForegroundState(session);
  const after = await sampleForegroundState(page);
  await page.evaluate(value => {
    const previous = window.__archiveForegroundProtection || {};
    window.__archiveForegroundProtection = {
      ...previous,
      ...value.applied,
      reassertions: Number(previous.reassertions || 0) + 1,
      lastReassertedAt: new Date().toISOString(),
      postInstallHasFocus: value.after.hasFocus,
      postInstallVisibilityState: value.after.visibilityState,
      postInstallHidden: value.after.hidden
    };
  }, { applied, after }).catch(() => {});
  return true;
}

export function pageForegroundProtectionInstalled(page) {
  return Boolean(page && foregroundSessions.has(page));
}

export { chromium };
