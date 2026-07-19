# Privacy Policy — Claude Usage Stats

_Last updated: July 2026_

Claude Usage Stats is a browser extension that displays your Claude usage (limits, current session/spend, reset times) directly on **claude.ai**.

## We do not collect your data

The extension does **not** collect, store on our servers, transmit, share, or sell any personal information. It has no analytics, no tracking, and no external servers of any kind.

## What it does with data

- It reads your usage numbers **only** from the **Settings → Usage** page of claude.ai, inside your own logged-in browser session — the same information already visible to you.
- Those numbers are cached **locally in your browser** (`chrome.storage.local`) for the sole purpose of displaying them and keeping them in sync across your open claude.ai tabs.
- **Nothing ever leaves your device.** The data is never sent to the developer or any third party.

## Permissions

- **`storage`** — to cache the usage numbers locally (above).
- **Host access to `https://claude.ai/*`** — the extension runs only on claude.ai; it requests access to no other website.

## Removing your data

Uninstalling the extension removes all locally cached data from your browser.

## Contact

Questions or issues: please open an issue at
https://github.com/prashanthmani16/claude-usage-tracker/issues

---

_This is an unofficial tool and is not affiliated with, endorsed by, or sponsored by Anthropic._
