# Claude Usage Stats — browser extension

Shows your Claude usage where your eyes already are, instead of buried in
settings:

- a **Weekly Usage limits** card in the side nav, just above your profile;
- a **Current session** strip tucked under the chat composer;
- a **Claude Design** meter under the Claude Design composer.

It adapts to your plan (Pro / Team / Max / Enterprise) and mirrors Claude's
light/dark theme.

Works in Chrome, Edge, Brave, Arc, Opera, and other Chromium browsers
(Manifest V3). Firefox would need small manifest tweaks.

---

## 1. Install (Load unpacked)

1. Unzip this folder somewhere permanent (don't delete it later — Chrome loads
   it from disk).
2. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this folder (the one containing
   `manifest.json`).
5. Open `https://claude.ai`. Your real numbers load automatically a second or
   two later (the extension reads Settings → Usage in the background) and refresh
   while the tab is open.

After editing any file, return to `chrome://extensions` and click the **reload**
icon on the card.

Out of the box it shows your **real usage** — no setup. The numbers come from the
**Settings → Usage** panel, read in the background (see step 3). To preview the
finished design without a live session instead, set `USE_MOCK = true` in
`usage-provider.js`.

---

## 2. What's in here

```
manifest.json        extension config (MV3)
usage-provider.js    >>> the data layer — the one file you wire to real data <<<
content.js           builds the UI and keeps it injected as Claude re-renders
styles.css           the finalized visual design (light + dark tokens)
icons/               toolbar icons
```

---

## 3. Where the real numbers come from (the background auto-pull)

There's no server to host. Because the script runs **on claude.ai**, it reads
your usage the same way the page does — using your existing logged-in session.

The session + weekly meters render only on **Settings → Usage**
(`#settings/usage`). There's no clean REST endpoint for them (the in-panel
Refresh hits an opaque cross-origin RPC), so `usage-provider.js` reads the panel
two ways — both verified against the live claude.ai DOM:

- **Auto** (`pullUsage`) — when the cache is stale, it loads `#settings/usage` in
  a hidden, same-origin iframe (~1–2s, invisible), scrapes each
  `[role="progressbar"]`'s `aria-valuenow`, and discards the iframe. So the
  meters stay fresh **without you opening settings**.
- **Passive** (`scrapeUsage`) — if you open Settings → Usage yourself, it scrapes
  that panel directly.

Results are cached in `chrome.storage.local` and broadcast to every open
claude.ai tab via `storage.onChanged`, so the first tab to refresh updates them
all (staleness-gated, ~60s cadence while the tab is visible).

If meters stop appearing or values look wrong after a claude.ai markup change,
retune `parseUsageDialog()` in `usage-provider.js` (it keys off the
"Plan usage limits" / "Weekly limits" headings and the progressbar
`aria-valuenow`).

---

## 4. Tuning the placement (if needed)

Claude ships with hashed, frequently-changing class names, so the extension
locates things **structurally** rather than by class. Everything adjustable is
isolated:

- **Where pieces attach** → the `FINDERS` section in `content.js`
  (`findComposer`, `findSidebarFooter`, `findDesignComposer`, `isDesignPage`).
- **How the strip sits behind the composer** → in `styles.css`, the
  `.cus-stats-layer` rules: `margin-top` controls how far it tucks up behind the
  composer, and `padding-top` controls the gap where the strip peeks out.
- **Colors / sizing** → the `--cus-*` design tokens at the top of `styles.css`.

---

## 5. Known caveats (worth a read)

- **It relies on Claude's internal, undocumented endpoints/DOM.** That's fine for
  a personal tool, but Anthropic can change them without notice, so expect to
  occasionally re-check the finders in `content.js` or `parseUsageDialog()` in
  `usage-provider.js`.
- **Composer position varies.** The design places the strip just below the
  composer, which fits the "new chat" screen. On a screen full of messages the
  composer sits at the very bottom — if the strip gets clipped or crowded there,
  adjust the `.cus-stats-layer` offsets (or change where `injectLayer` attaches).
- This is an unofficial tool and isn't affiliated with Anthropic.
