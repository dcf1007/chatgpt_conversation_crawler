import { chromium } from 'playwright';
import { installChromiumBackgroundProtection } from './chromium-background-protection.mjs';

const foregroundSessions = new WeakMap();

// Keep Chromium's renderer/timer/background-window throttles disabled for the
// headed authenticated capture context. This remains capture behavior rather
// than diagnostic-only behavior.
installChromiumBackgroundProtection(chromium);

/**
 * Ask Chromium to treat the capture page as focused even when the OS window is
 * not foregrounded. The beta13.1 diagnostic run repeatedly resumed when the
 * user focused the window, so beta14-dev makes focus scheduling explicit at
 * the page/CDP layer instead of relying only on launch flags.
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
  try {
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch (error) {
    await session.detach?.().catch?.(() => {});
    throw error;
  }

  foregroundSessions.set(page, session);
  const after = await page.evaluate(() => ({
    hasFocus: Boolean(document.hasFocus?.()),
    visibilityState: document.visibilityState || '',
    hidden: Boolean(document.hidden)
  })).catch(() => ({ hasFocus: null, visibilityState: '', hidden: null }));

  await page.evaluate(value => {
    window.__archiveForegroundProtection = {
      focusEmulation: true,
      installedAt: new Date().toISOString(),
      preInstallHasFocus: value.before.hasFocus,
      preInstallVisibilityState: value.before.visibilityState,
      preInstallHidden: value.before.hidden,
      postInstallHasFocus: value.after.hasFocus,
      postInstallVisibilityState: value.after.visibilityState,
      postInstallHidden: value.after.hidden
    };
  }, { before, after }).catch(() => {});
  return true;
}

export function pageForegroundProtectionInstalled(page) {
  return Boolean(page && foregroundSessions.has(page));
}

export { chromium };
