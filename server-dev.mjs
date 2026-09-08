// Install common Chromium runtime behavior before the development hook wraps
// Playwright launch methods. This keeps beta11's normal browser/session flags.
await import('./src/runtime-browser.mjs');

// Development-only diagnostics. The clean beta11 release does not contain this
// launcher, MHTML recording, or the authenticated manual comparison phase.
process.env.CHATGPT_CRAWLER_MANUAL_INSPECTION ??= '1';
await import('./src/mhtml-dev-hook.mjs');
await import('./server.mjs');
