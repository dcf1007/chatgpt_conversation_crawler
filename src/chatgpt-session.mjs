import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://chatgpt.com/';
const PROFILE_NAME = 'browser-profile';
const HOME_SCREENSHOT_NAME = 'session-home-diagnostic.png';
const SHARE_SCREENSHOT_NAME = 'session-share-diagnostic.png';
const AUTH_COOKIE_RE = /^(?:(?:__Secure|__Host)-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/i;
const HUMAN_VERIFY_RE = /verify you are human|checking your browser|performing security verification|security verification/i;
const INTERACTIVE_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createChatGptSessionManager(projectRoot) {
  const profileDir = path.join(projectRoot, PROFILE_NAME);
  const publicDir = path.join(projectRoot, 'public');
  const homeScreenshotPath = path.join(publicDir, HOME_SCREENSHOT_NAME);
  const shareScreenshotPath = path.join(publicDir, SHARE_SCREENSHOT_NAME);
  let profileOwner = '';
  let loginProcess = null;
  let loginFinalizePromise = null;
  let interactiveCheckContext = null;
  let interactiveCheckPromise = null;
  let lastAuthenticated = null;
  let lastCheckedAt = 0;
  let lastCheckDetail = 'Session has not been checked yet.';

  void Promise.all([
    fs.rm(homeScreenshotPath, { force: true }),
    fs.rm(shareScreenshotPath, { force: true })
  ]).catch(() => {});

  async function profileExists() {
    try {
      return (await fs.stat(profileDir)).isDirectory();
    } catch {
      return false;
    }
  }

  async function acquire(owner, { wait = false, shouldCancel, onWait } = {}) {
    while (profileOwner) {
      if (!wait) throw codedError(`The saved ChatGPT profile is currently in use by ${profileOwner}.`, 'PROFILE_BUSY');
      if (shouldCancel?.()) throw codedError('Archive cancelled.', 'ARCHIVE_CANCELLED');
      await onWait?.(profileOwner);
      await delay(250);
    }
    profileOwner = owner;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (profileOwner === owner) profileOwner = '';
    };
  }

  async function authCookieEvidence(context) {
    const nowSeconds = Date.now() / 1000;
    const cookies = await context.cookies([LOGIN_URL]).catch(() => []);
    const authCookies = cookies.filter(cookie => {
      if (!AUTH_COOKIE_RE.test(cookie.name || '')) return false;
      return !Number.isFinite(cookie.expires) || cookie.expires < 0 || cookie.expires > nowSeconds;
    });
    return {
      present: authCookies.length > 0,
      count: authCookies.length
    };
  }

  async function captureDiagnosticScreenshot(page, outputPath, { settleMs = 1500 } = {}) {
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    if (settleMs > 0) await delay(settleMs);
    await page.screenshot({
      path: outputPath,
      type: 'png',
      fullPage: false,
      animations: 'disabled'
    });
  }

  async function challengeState(page) {
    if (!page || page.isClosed()) return { challenged: false, closed: true };
    const bodyText = await page.locator('body').innerText({ timeout: 1500 }).catch(() => '');
    const frameUrls = page.frames().slice(1).map(frame => frame.url()).filter(Boolean);
    const challenged = HUMAN_VERIFY_RE.test(bodyText)
      || frameUrls.some(url => /challenges\.cloudflare\.com|turnstile/i.test(url));
    return { challenged, closed: false };
  }

  async function waitForHumanVerification(page, {
    timeoutMs = INTERACTIVE_VERIFY_TIMEOUT_MS,
    screenshotPath,
    purpose = 'ChatGPT page'
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let challengeSeen = false;
    let clearChecks = 0;

    while (Date.now() < deadline) {
      const state = await challengeState(page);
      if (state.closed) {
        throw codedError(`The ${purpose} browser window was closed before verification completed.`, 'VERIFICATION_CLOSED');
      }

      if (state.challenged) {
        challengeSeen = true;
        clearChecks = 0;
        lastAuthenticated = null;
        lastCheckedAt = Date.now();
        lastCheckDetail = `Cloudflare human verification is visible in the ${purpose} browser. Complete it manually in that Chromium window; the crawler will continue automatically when the challenge clears.`;
        if (screenshotPath) await captureDiagnosticScreenshot(page, screenshotPath, { settleMs: 100 }).catch(() => {});
        await delay(750);
        continue;
      }

      clearChecks += 1;
      if (clearChecks >= 2) {
        if (screenshotPath) await captureDiagnosticScreenshot(page, screenshotPath, { settleMs: challengeSeen ? 750 : 1200 }).catch(() => {});
        return { challengeSeen };
      }
      await delay(750);
    }

    throw codedError(`Timed out waiting for manual Cloudflare verification in the ${purpose} browser.`, 'VERIFICATION_TIMEOUT');
  }

  async function probeContext(context) {
    try {
      const evidence = await authCookieEvidence(context);
      lastAuthenticated = evidence.present;
      lastCheckedAt = Date.now();
      lastCheckDetail = evidence.present
        ? 'A saved ChatGPT authentication session token is present in this browser profile. The requested ChatGPT page is used as the final access check.'
        : 'No current ChatGPT authentication session token was found in this browser profile. Open ChatGPT login and sign in again.';
      return {
        authenticated: evidence.present,
        status: evidence.present ? 200 : 401,
        detail: lastCheckDetail,
        evidence: evidence.present ? 'auth-cookie' : 'none'
      };
    } catch (error) {
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      lastCheckDetail = error?.message || 'The saved ChatGPT authentication state could not be inspected.';
      return { authenticated: null, status: 0, detail: lastCheckDetail, evidence: 'error' };
    }
  }

  async function probePage(page) {
    await captureDiagnosticScreenshot(page, shareScreenshotPath, { settleMs: 300 }).catch(() => {});
    await waitForHumanVerification(page, {
      screenshotPath: shareScreenshotPath,
      purpose: 'authenticated share-page'
    });
    return probeContext(page.context());
  }

  async function status() {
    const exists = await profileExists();
    return {
      profileName: PROFILE_NAME,
      profilePath: `./${PROFILE_NAME}`,
      profileExists: exists,
      busy: Boolean(profileOwner),
      owner: profileOwner,
      loginWindowOpen: Boolean(loginProcess),
      verificationWindowOpen: Boolean(interactiveCheckContext),
      authenticated: exists ? lastAuthenticated : false,
      lastCheckedAt: exists ? lastCheckedAt : 0,
      detail: exists ? lastCheckDetail : 'No saved browser profile exists yet. Open the ChatGPT login browser to create one.'
    };
  }

  async function launchPersistentProfile({ headless, viewport }) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await chromium.launchPersistentContext(profileDir, {
          headless,
          viewport,
          javaScriptEnabled: true
        });
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(400 * (attempt + 1));
      }
    }
    throw lastError;
  }

  async function verifyOwnedProfile({ captureHome = false } = {}) {
    let context;
    try {
      context = await launchPersistentProfile({ headless: true, viewport: { width: 1440, height: 1000 } });
      if (captureHome) {
        const page = context.pages()[0] || await context.newPage();
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
        await captureDiagnosticScreenshot(page, homeScreenshotPath).catch(() => {});
      }
      return await probeContext(context);
    } finally {
      await context?.close().catch(() => {});
    }
  }

  async function finalizeLoginProcess(child, release, exitCode, signal) {
    if (loginProcess !== child) return;
    loginProcess = null;
    lastAuthenticated = null;
    lastCheckedAt = 0;
    lastCheckDetail = 'Login browser closed; checking the saved ChatGPT authentication state.';
    try {
      await delay(750);
      await verifyOwnedProfile({ captureHome: true });
    } catch (error) {
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      const suffix = signal ? ` (browser signal ${signal})` : (Number.isInteger(exitCode) ? ` (browser exit ${exitCode})` : '');
      lastCheckDetail = `The login browser closed${suffix}, but the saved ChatGPT authentication state could not be inspected: ${error?.message || 'unknown error'}`;
    } finally {
      release();
      loginFinalizePromise = null;
    }
  }

  async function openLoginWindow() {
    if (loginProcess) return status();
    const release = await acquire('standalone login browser');
    try {
      await fs.mkdir(profileDir, { recursive: true });
      const executable = chromium.executablePath();
      const child = spawn(executable, [
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        LOGIN_URL
      ], {
        stdio: 'ignore',
        windowsHide: false
      });

      loginProcess = child;
      lastAuthenticated = null;
      lastCheckedAt = 0;
      lastCheckDetail = 'Standalone Playwright-bundled Chromium is open without a Playwright connection. Complete the ChatGPT sign-in there, then close the browser; the crawler will inspect the saved authentication state afterward.';

      child.once('error', error => {
        if (loginProcess !== child) return;
        loginProcess = null;
        lastAuthenticated = null;
        lastCheckedAt = Date.now();
        lastCheckDetail = `The standalone login browser could not be started: ${error?.message || 'unknown error'}`;
        release();
      });

      child.once('exit', (code, signal) => {
        if (loginProcess !== child) return;
        loginFinalizePromise = finalizeLoginProcess(child, release, code, signal);
        void loginFinalizePromise.catch(() => {});
      });

      return status();
    } catch (error) {
      loginProcess = null;
      release();
      throw error;
    }
  }

  async function closeLoginWindow() {
    const child = loginProcess;
    if (!child) {
      if (loginFinalizePromise) await loginFinalizePromise.catch(() => {});
      return status();
    }

    const exited = new Promise(resolve => child.once('exit', resolve));
    try { child.kill('SIGTERM'); } catch {}
    await Promise.race([exited, delay(5000)]);
    if (loginProcess === child) {
      try { child.kill('SIGKILL'); } catch {}
      await Promise.race([exited, delay(2000)]);
    }
    if (loginFinalizePromise) await loginFinalizePromise.catch(() => {});
    return status();
  }

  async function runInteractiveCheck(release) {
    let context;
    try {
      context = await launchPersistentProfile({ headless: false, viewport: { width: 1440, height: 1000 } });
      interactiveCheckContext = context;
      const page = context.pages()[0] || await context.newPage();
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      lastCheckDetail = 'Interactive Playwright session check is open. If ChatGPT shows Cloudflare verification, complete it manually in that Chromium window; it will close automatically after the challenge clears.';
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await waitForHumanVerification(page, {
        screenshotPath: homeScreenshotPath,
        purpose: 'interactive session-check'
      });
      await probeContext(context);
    } catch (error) {
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      lastCheckDetail = error?.message || 'Interactive ChatGPT session verification failed.';
    } finally {
      interactiveCheckContext = null;
      await context?.close().catch(() => {});
      release();
      interactiveCheckPromise = null;
    }
  }

  async function checkSession() {
    if (!await profileExists()) {
      lastAuthenticated = false;
      lastCheckedAt = Date.now();
      lastCheckDetail = 'No saved browser profile exists yet.';
      return status();
    }
    if (interactiveCheckPromise) return status();
    const release = await acquire('interactive session check');
    interactiveCheckPromise = runInteractiveCheck(release);
    void interactiveCheckPromise.catch(() => {});
    await delay(150);
    return status();
  }

  async function openAuthenticatedContext(owner, { shouldCancel, onWait } = {}) {
    const release = await acquire(owner, { wait: true, shouldCancel, onWait });
    try {
      await fs.mkdir(profileDir, { recursive: true });
      const context = await launchPersistentProfile({ headless: false, viewport: { width: 1440, height: 1000 } });
      const page = context.pages()[0] || await context.newPage();
      return {
        context,
        page,
        async close() {
          await context.close().catch(() => {});
          release();
        },
        release
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  async function forgetProfile() {
    const release = await acquire('profile deletion');
    try {
      await fs.rm(profileDir, { recursive: true, force: true });
      await Promise.all([
        fs.rm(homeScreenshotPath, { force: true }),
        fs.rm(shareScreenshotPath, { force: true })
      ]).catch(() => {});
      lastAuthenticated = false;
      lastCheckedAt = Date.now();
      lastCheckDetail = 'Saved ChatGPT browser profile was deleted.';
    } finally {
      release();
    }
    return status();
  }

  return {
    profileDir,
    status,
    probePage,
    openLoginWindow,
    closeLoginWindow,
    checkSession,
    openAuthenticatedContext,
    forgetProfile
  };
}
