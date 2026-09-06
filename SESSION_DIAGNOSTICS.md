# Authenticated session diagnostics

`v1.6.7-beta5` makes the authenticated Playwright path interactive when ChatGPT presents a Cloudflare human-verification challenge.

Open:

```text
http://localhost:3000/session-diagnostics.html
```

## Why this is not an iframe

The crawler UI runs in your normal browser, while the crawler's authenticated state lives in Playwright's separate persistent `./browser-profile` Chromium profile. An iframe embedded in the localhost UI would use the normal browser's cookie/storage session rather than the crawler profile, and the remote site may also restrict framing.

Instead, beta5 opens the actual persistent Playwright Chromium profile in a visible browser window so any human-verification interaction occurs in the same browser session the crawler uses.

## Interactive session check

Click **Open interactive Playwright verification** on the diagnostics page, or click **Check session** on the main crawler page.

The session manager:

1. acquires the persistent-profile lock;
2. opens `./browser-profile` in visible Playwright Chromium with a 1440×1000 viewport;
3. navigates to `https://chatgpt.com/`;
4. detects a visible Cloudflare/Turnstile human-verification challenge;
5. if a challenge is present, leaves the browser open and waits while you complete it manually;
6. after the challenge clears for consecutive checks, captures the viewport as `public/session-home-diagnostic.png`;
7. inspects only authentication-cookie metadata, without exposing cookie values;
8. closes Chromium and releases the profile lock.

The crawler does not click, solve, or otherwise automate the challenge. The user performs the verification directly in the visible Chromium window.

The interactive verification wait has a ten-minute safety timeout. Closing the browser before the challenge clears ends the check as incomplete.

## Authenticated archive behavior

Authenticated archive jobs now use visible Playwright Chromium rather than headless Chromium. This is intentional in beta5 so the same browser that performs the crawl can receive manual human verification.

After the requested `https://chatgpt.com/share/...` page loads, the crawler:

1. captures an initial viewport diagnostic;
2. checks whether Cloudflare human verification is present;
3. if challenged, pauses before traversal and leaves the browser visible;
4. waits while you complete the challenge manually;
5. captures the cleared page again;
6. resumes the existing crawler traversal without changing the traversal/snapshot logic.

The latest share-page viewport is written to:

```text
public/session-share-diagnostic.png
```

Refresh the diagnostics page to view it.

## Login behavior remains separate

The **Open ChatGPT login** button still launches Playwright's bundled Chromium as an unmanaged standalone OS process. Playwright does not attach to that browser during Google/SSO login. Beta5 changes only session verification and authenticated archive visibility; it does not move Google login back under Playwright control.

## Privacy and lifetime

The two PNGs are runtime diagnostics only:

- they are ignored by Git;
- they are not included in source release ZIPs because they are not tracked;
- they are not inserted into generated conversation archives;
- they are removed when the crawler process starts;
- they are removed by **Forget saved session**.

They can contain account or conversation information while the crawler is running. Keep the crawler bound to localhost and do not expose its `public/` directory or HTTP port to untrusted systems.
