import { chromium } from 'playwright';
import { installChromiumBackgroundProtection } from './src/chromium-background-protection.mjs';

// Development-only diagnostics are deliberately enabled here instead of in
// server.mjs so the clean beta7 server can later drop them without surgery.
process.env.CHATGPT_CRAWLER_MANUAL_INSPECTION ??= '1';

// Keep headed authenticated Chromium active when the user minimizes or covers
// its window. This is intentionally isolated to the development launcher.
installChromiumBackgroundProtection(chromium);

await import('./src/mhtml-dev-hook.mjs');
await import('./server.mjs');
