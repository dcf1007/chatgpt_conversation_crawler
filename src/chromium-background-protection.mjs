const PATCH_MARK = Symbol.for('chatgpt-conversation-crawler.chromium-background-protection');

export const CHROMIUM_BACKGROUND_PROTECTION_ARGS = Object.freeze([
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding'
]);

export function withChromiumBackgroundProtection(options = {}) {
  const existing = Array.isArray(options.args) ? options.args : [];
  const args = [
    ...CHROMIUM_BACKGROUND_PROTECTION_ARGS.filter(flag => !existing.includes(flag)),
    ...existing
  ];
  return { ...options, args };
}

/**
 * Development-only launch patch. The authenticated archive and interactive
 * session-check both use chromium.launchPersistentContext(). Keep the browser
 * headed, but prevent Chromium from slowing its renderer merely because the
 * window is minimized, occluded, or in the background.
 *
 * The standalone login browser is intentionally unaffected because it is
 * spawned as a plain OS process for Google/SSO compatibility.
 */
export function installChromiumBackgroundProtection(chromiumBrowserType) {
  if (!chromiumBrowserType) throw new TypeError('Chromium BrowserType is required.');
  const prototype = Object.getPrototypeOf(chromiumBrowserType);
  if (!prototype || typeof prototype.launchPersistentContext !== 'function') {
    throw new TypeError('Chromium BrowserType does not expose launchPersistentContext().');
  }
  if (prototype[PATCH_MARK]) return false;

  const target = chromiumBrowserType;
  const original = prototype.launchPersistentContext;
  Object.defineProperty(prototype, PATCH_MARK, { value: true, configurable: false });
  Object.defineProperty(prototype, 'launchPersistentContext', {
    configurable: true,
    writable: true,
    value(userDataDir, options = {}) {
      const nextOptions = this === target && options?.headless === false
        ? withChromiumBackgroundProtection(options)
        : options;
      return original.call(this, userDataDir, nextOptions);
    }
  });
  return true;
}
