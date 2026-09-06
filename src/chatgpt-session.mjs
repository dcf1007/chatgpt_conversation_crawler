import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const LOGIN_URL = 'https://chatgpt.com/';
const PROFILE_NAME = 'browser-profile';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createChatGptSessionManager(projectRoot) {
  const profileDir = path.join(projectRoot, PROFILE_NAME);
  let profileOwner = '';
  let loginProcess = null;
  let loginFinalizePromise = null;
  let lastAuthenticated = null;
  let lastCheckedAt = 0;
  let lastCheckDetail = 'Session has not been checked yet.';

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

  async function probePage(page) {
    try {
      if (!/^https:\/\/(?:www\.)?chatgpt\.com(?:\/|$)/i.test(page.url())) {
        lastAuthenticated = null;
        lastCheckedAt = Date.now();
        lastCheckDetail = 'The browser is not currently on chatgpt.com, so the ChatGPT session could not be verified.';
        return { authenticated: null, status: 0, detail: lastCheckDetail };
      }
      const result = await page.evaluate(async () => {
        try {
          const response = await fetch('/api/auth/session', {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { accept: 'application/json' }
          });
          const text = await response.text();
          let data = null;
          try { data = text ? JSON.parse(text) : null; } catch {}
          if (response.status === 200) {
            return {
              authenticated: Boolean(data?.user || data?.accessToken),
              status: response.status,
              detail: data?.user || data?.accessToken
                ? 'ChatGPT reports an authenticated browser session.'
                : 'ChatGPT reports no authenticated user in this browser profile.'
            };
          }
          if (response.status === 401) {
            return { authenticated: false, status: 401, detail: 'ChatGPT reports that the saved session is not authenticated.' };
          }
          return {
            authenticated: null,
            status: response.status,
            detail: `ChatGPT session check returned HTTP ${response.status}; authentication could not be verified.`
          };
        } catch (error) {
          return {
            authenticated: null,
            status: 0,
            detail: error?.message || 'ChatGPT session check could not be completed.'
          };
        }
      });
      lastAuthenticated = result.authenticated;
      lastCheckedAt = Date.now();
      lastCheckDetail = result.detail;
      return result;
    } catch (error) {
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      lastCheckDetail = error?.message || 'ChatGPT session check could not be completed.';
      return { authenticated: null, status: 0, detail: lastCheckDetail };
    }
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

  async function verifyOwnedProfile() {
    let context;
    try {
      context = await launchPersistentProfile({ headless: true, viewport: { width: 1280, height: 900 } });
      const page = context.pages()[0] || await context.newPage();
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      return await probePage(page);
    } finally {
      await context?.close().catch(() => {});
    }
  }

  async function finalizeLoginProcess(child, release, exitCode, signal) {
    if (loginProcess !== child) return;
    loginProcess = null;
    lastAuthenticated = null;
    lastCheckedAt = 0;
    lastCheckDetail = 'Login browser closed; checking the saved ChatGPT session.';
    try {
      await delay(500);
      await verifyOwnedProfile();
    } catch (error) {
      lastAuthenticated = null;
      lastCheckedAt = Date.now();
      const suffix = signal ? ` (browser signal ${signal})` : (Number.isInteger(exitCode) ? ` (browser exit ${exitCode})` : '');
      lastCheckDetail = `The login browser closed${suffix}, but the saved ChatGPT session could not be verified: ${error?.message || 'unknown error'}`;
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
      lastCheckDetail = 'Standalone Playwright-bundled Chromium is open without a Playwright connection. Complete the ChatGPT sign-in there, then close the browser; the crawler will verify the saved session afterward.';

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

  async function checkSession() {
    if (!await profileExists()) {
      lastAuthenticated = false;
      lastCheckedAt = Date.now();
      lastCheckDetail = 'No saved browser profile exists yet.';
      return status();
    }
    const release = await acquire('session check');
    try {
      await verifyOwnedProfile();
    } finally {
      release();
    }
    return status();
  }

  async function openAuthenticatedContext(owner, { shouldCancel, onWait } = {}) {
    const release = await acquire(owner, { wait: true, shouldCancel, onWait });
    try {
      await fs.mkdir(profileDir, { recursive: true });
      const context = await launchPersistentProfile({ headless: true, viewport: { width: 1440, height: 1000 } });
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
