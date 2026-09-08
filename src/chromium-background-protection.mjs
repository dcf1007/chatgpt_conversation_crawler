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
 * Patch headed persistent Chromium contexts so capture work does not slow down
 * merely because the authenticated browser window is minimized, occluded, or
 * in the background. Anonymous headless contexts and the unmanaged standalone
 * login browser are intentionally unaffected.
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
