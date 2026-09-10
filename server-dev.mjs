// Install common Chromium runtime behavior before the development hook wraps
// Playwright launch methods. This keeps the normal browser/session protection
// active before beta14-dev adds page-level focus emulation during crawling.
await import('./src/runtime-browser.mjs');

// Development-only diagnostics. Clean releases do not contain this launcher,
// MHTML recording, or the authenticated manual comparison phase.
process.env.CHATGPT_CRAWLER_MANUAL_INSPECTION ??= '1';
await import('./src/mhtml-dev-hook.mjs');
await import('./server.mjs');
