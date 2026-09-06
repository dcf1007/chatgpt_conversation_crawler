import fs from 'node:fs/promises';
import path from 'node:path';
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
  let loginContext = null;
  let loginPoll = null;
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
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
      loginWindowOpen: Boolean(loginContext),
      authenticated: exists ? lastAuthenticated : false,
      lastCheckedAt: exists ? lastCheckedAt : 0,
      detail: exists ? lastCheckDetail : 'No saved browser profile exists yet. Open the ChatGPT login window to create one.'
    };
  }

  function clearLoginState(release) {
    if (loginPoll) clearInterval(loginPoll);
    loginPoll = null;
    loginContext = null;
    release?.();
  }

  async function openLoginWindow() {
    if (loginContext) return status();
    const release = await acquire('login window');
    try {
      await fs.mkdir(profileDir, { recursive: true });
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: true
      });
      loginContext = context;
      const page = context.pages()[0] || await context.newPage();
      context.once('close', () => clearLoginState(release));
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await probePage(page).catch(() => {});
      loginPoll = setInterval(() => {
        if (!loginContext) return;
        const activePage = context.pages().find(candidate => /^https:\/\/(?:www\.)?chatgpt\.com(?:\/|$)/i.test(candidate.url())) || context.pages()[0];
        if (activePage) void probePage(activePage).catch(() => {});
      }, 2000);
      loginPoll.unref?.();
      return status();
    } catch (error) {
      clearLoginState(release);
      throw error;
    }
  }

  async function closeLoginWindow() {
    if (!loginContext) return status();
    const context = loginContext;
    const page = context.pages().find(candidate => /^https:\/\/(?:www\.)?chatgpt\.com(?:\/|$)/i.test(candidate.url())) || context.pages()[0];
    if (page) await probePage(page).catch(() => {});
    await context.close().catch(() => {});
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
    let context;
    try {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: true
      });
      const page = context.pages()[0] || await context.newPage();
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      await probePage(page);
    } finally {
      await context?.close().catch(() => {});
      release();
    }
    return status();
  }

  async function openAuthenticatedContext(owner, { shouldCancel, onWait } = {}) {
    const release = await acquire(owner, { wait: true, shouldCancel, onWait });
    try {
      await fs.mkdir(profileDir, { recursive: true });
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1440, height: 1000 },
        javaScriptEnabled: true
      });
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
