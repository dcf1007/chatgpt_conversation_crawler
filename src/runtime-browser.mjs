import { chromium } from 'playwright';
import { installChromiumBackgroundProtection } from './chromium-background-protection.mjs';

// This protection is capture behavior, not diagnostic behavior. Install it
// before any development instrumentation wraps Chromium launch methods so both
// diagnostic and clean builds keep headed authenticated rendering active while
// the window is minimized or occluded.
installChromiumBackgroundProtection(chromium);

export { chromium };
