// Install common Chromium runtime behavior before the diagnostic hook wraps
// Playwright launch methods.
await import('./src/runtime-browser.mjs');

// Development-only diagnostics. The clean beta10 release removes this launcher,
// MHTML recording, and the manual validation phase entirely.
process.env.CHATGPT_CRAWLER_MANUAL_INSPECTION ??= '1';
await import('./src/mhtml-dev-hook.mjs');
await import('./server.mjs');
