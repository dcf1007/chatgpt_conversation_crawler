# Authenticated session diagnostics

`v1.6.7-beta4` adds a local visual diagnostic for the saved ChatGPT browser profile.

Open:

```text
http://localhost:3000/session-diagnostics.html
```

The page shows two screenshots produced by the crawler's **headless Playwright Chromium** using the same persistent `./browser-profile` used by authenticated archive jobs.

## ChatGPT home screenshot

Click **Capture ChatGPT home now** on the diagnostics page, or click **Check session** on the main crawler page.

The session manager:

1. acquires the persistent-profile lock;
2. opens the saved profile in headless Chromium with the same 1440×1000 viewport used for authenticated crawling;
3. navigates to `https://chatgpt.com/`;
4. waits for DOM/network settling;
5. captures the visible viewport as `public/session-home-diagnostic.png`;
6. inspects only authentication-cookie metadata, without exposing cookie values;
7. closes Chromium and releases the profile lock.

The screenshot lets you visually distinguish a normal logged-in ChatGPT home page from a logged-out page, challenge/interstitial, error page, or other headless-only behavior.

## Authenticated share-page screenshot

When an authenticated archive opens its requested `https://chatgpt.com/share/...` page, the crawler automatically captures the visible viewport before traversal begins. The latest such image is written to:

```text
public/session-share-diagnostic.png
```

Refresh the diagnostics page to view it.

This makes it possible to compare what the standalone login Chromium shows with what the actual headless archive browser sees.

## Privacy and lifetime

The two PNGs are runtime diagnostics only:

- they are ignored by Git;
- they are not included in source release ZIPs because they are not tracked;
- they are not inserted into generated conversation archives;
- they are removed when the crawler process starts;
- they are removed by **Forget saved session**.

They can contain account or conversation information while the crawler is running. Keep the crawler bound to localhost and do not expose its `public/` directory or HTTP port to untrusted systems.
