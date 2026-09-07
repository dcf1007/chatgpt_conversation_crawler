// Development-only diagnostics are deliberately enabled here instead of in
// server.mjs so the clean beta7 server can later drop them without surgery.
process.env.CHATGPT_CRAWLER_MANUAL_INSPECTION ??= '1';

await import('./src/mhtml-dev-hook.mjs');
await import('./server.mjs');
