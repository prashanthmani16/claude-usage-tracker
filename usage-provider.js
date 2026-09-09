/* =============================================================================
 *  Claude Usage Tracker — DATA PROVIDER  (real-data background auto-pull)
 *  ===========================================================================
 *  content.js calls ClaudeUsageProvider.fetchUsage() and renders whatever it
 *  returns. This file is the data layer: it reads your REAL usage numbers off
 *  the **Settings → Usage** panel and keeps them fresh in the background, so the
 *  meters update WITHOUT you opening settings.
 *
 *  There is no clean REST endpoint for these numbers (the in-panel Refresh hits
 *  an opaque cross-origin RPC), so we read them from the Usage panel's DOM two
 *  ways — both verified against the live claude.ai DOM:
 *
 *    - scrapeUsage()  — passive: when the Usage panel is already open in the
 *                       page, read it directly.
 *    - pullUsage()    — active: load `#settings/usage` in a hidden, same-origin
 *                       iframe (~1–2s, invisible), scrape it, and discard it.
 *
 *  Results are cached in chrome.storage.local and broadcast to every claude.ai
 *  tab via storage.onChanged, so the first tab to refresh updates them all.
 *
 *  fetchUsage() resolves to an object shaped like this (or null if nothing has
 *  been scraped yet):
 *
 *  {
 *    plan: "pro" | "team" | "max" | "enterprise",
 *    sidebar: [ { name: "All models", pct: 64, reset: "Resets Sat 7:20 PM" } ],
 *    session: { type: "session", name: "Current session", pct: 33, reset: "Resets in 2h 14m" },
 *    design:  null      // design credits live on a different surface; not scraped
 *  }
 *
 *  `pct` is a number 0–100. `reset` is just a string shown next to the timer.
 * ========================================================================== */
(function () {
  "use strict";

  /* ===== 0. MOCK MODE (dev only) ======================================= */
  // Set to true to bypass scraping and render fixed preview data instead.
  const USE_MOCK = false;
  const MOCK_PLAN = "max";
  const MOCK = {
    pro: { plan: "pro",
      sidebar: [{ name: "All Models", pct: 64, reset: "Sat 7:20 PM" }],
      session: { type: "session", name: "Current session", pct: 33, reset: "2h 14m" }, design: null },
    team: { plan: "team",
      sidebar: [{ name: "All Models", pct: 64, reset: "Sat 7:20 PM" }],
      session: { type: "session", name: "Current session", pct: 33, reset: "2h 14m" }, design: null },
    max: { plan: "max",
      sidebar: [
        { name: "All Models", pct: 64, reset: "Sat 7:20 PM" },
        { name: "Sonnet only", pct: 40, reset: "4h 32m" },
      ],
      session: { type: "session", name: "Current session", pct: 33, reset: "2h 14m" }, design: null },
    enterprise: { plan: "enterprise",
      sidebar: [], // no weekly limits -> no side-nav card; stats live under the composer
      session: { type: "spend", currency: "$", spent: 19.80, total: 125.0, pct: 16, reset: "Resets Sat, Aug 1" },
      design: { name: "Claude Design", pct: 99, reset: "Expires July 18" } },
  };

  /* ===== 0b. which organisation these numbers belong to ================
   * One account can hold several organisations with completely separate limits
   * (a Team and an Enterprise, say). Cached numbers therefore belong to ONE of
   * them, and showing them after a switch shows the wrong plan's usage.
   * ================================================================== */
  function orgKey() {
    // Preferred: whatever claude.ai itself uses to remember the active org.
    try {
      const jar = (document.cookie || "").split(";");
      const named = {};
      for (const part of jar) {
        const i = part.indexOf("=");
        if (i < 0) continue;
        named[part.slice(0, i).trim()] = part.slice(i + 1).trim();
      }
      for (const name of ["lastActiveOrg", "activeOrg", "activeOrganization", "organizationId"]) {
        if (named[name]) return "c:" + named[name];
      }
      // Cookie names change; fall back to any that looks organisation-ish.
      for (const name of Object.keys(named)) {
        if (/org/i.test(name) && named[name]) return "c:" + name + "=" + named[name];
      }
    } catch (_) {}
    // Last resort: the org label the user actually sees in the profile row. It
    // changes on a switch, which is exactly the signal needed.
    try {
      const row = document.querySelector(".df-footer-row");
      const t = row && (row.textContent || "").replace(/\s+/g, " ").trim();
      if (t) return "l:" + t;
    } catch (_) {}
    return "";
  }

  // Unknown on either side means "don't fight it" — better to show numbers than
  // to blank the UI because an org could not be identified.
  function orgMatches(m) {
    if (!m) return false;
    const cur = orgKey();
    if (!m.org || !cur) return true;
    return m.org === cur;
  }

  /* ===== 1. storage cache + cross-tab sync ============================= */
  const KEY = "cus:model";      // most recent, whichever org it belongs to
  const ARCHIVE = "cus:models"; // { [org]: model } so a switch back is instant
  // Adaptive cadence. Each refresh boots claude.ai's app inside an iframe, which
  // is far too costly to run on a tight fixed timer — but the numbers only move
  // while someone is actually working. So poll quickly for a few minutes after
  // any activity and back off hard when the tab is just sitting open.
  const FRESH_ACTIVE_MS = 15 * 1000;
  const FRESH_IDLE_MS = 90 * 1000;
  const ACTIVE_WINDOW_MS = 3 * 60 * 1000;
  const TICK_MS = 5 * 1000; // cheap check; the staleness gate below decides
  let lastActivityAt = Date.now();
  function freshnessMs() {
    return Date.now() - lastActivityAt < ACTIVE_WINDOW_MS ? FRESH_ACTIVE_MS : FRESH_IDLE_MS;
  }
  function noteActivity() { lastActivityAt = Date.now(); }

  function read() {
    return new Promise((res) => {
      try {
        chrome.storage.local.get([KEY, ARCHIVE], (o) => {
          const latest = (o && o[KEY]) || null;
          if (orgMatches(latest)) return res(latest);
          // Latest belongs to the org we just switched away from; the previous
          // numbers for THIS org are better than nothing while a pull runs.
          const arch = (o && o[ARCHIVE]) || {};
          res(arch[orgKey()] || null);
        });
      } catch (_) { res(null); }
    });
  }
  function write(model) {
    return new Promise((res) => {
      try {
        chrome.storage.local.get(ARCHIVE, (o) => {
          const arch = (o && o[ARCHIVE]) || {};
          if (model && model.org) arch[model.org] = model;
          const patch = {};
          patch[KEY] = model;
          patch[ARCHIVE] = arch;
          chrome.storage.local.set(patch, res);
        });
      } catch (_) { res(); }
    });
  }
  function onChange(cb) {
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area !== "local" || !ch[KEY]) return;
        const m = ch[KEY].newValue || null;
        if (orgMatches(m)) cb(m); // ignore a sibling tab refreshing another org
      });
    } catch (_) {}
  }
  function isStale(m, ms) { return !m || Date.now() - (m.updatedAt || 0) > ms; }

  /* ===== 2. Settings → Usage scraper =================================== */
  const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));

  function planKey(plan) {
    const t = (plan || "").toLowerCase();
    if (t.includes("max")) return "max";
    if (t.includes("enterprise")) return "enterprise";
    if (t.includes("team")) return "team";
    if (t.includes("pro")) return "pro";
    if (t.includes("free")) return "free";
    return detectPlanFromDOM();
  }

  // Find the Settings → Usage dialog in a document (page or iframe).
  // Covers both layouts: "Plan usage limits" (Pro/Max) and "Your usage
  // limits" (Enterprise / spend-based).
  function usageDialogIn(doc) {
    try {
      const dlgs = [].slice.call(doc.querySelectorAll('[role="dialog"]'));
      for (var i = 0; i < dlgs.length; i++) {
        if (/(Plan|Your) usage limits/i.test(dlgs[i].innerText || "")) return dlgs[i];
      }
      return null;
    } catch (_) { return null; }
  }

  /* Pure parse of a Usage dialog element -> target-shaped model (no storage).
   * Works on any document. Reads each progressbar's aria-valuenow; sections
   * split by their headings. Handles BOTH live layouts:
   *   - Pro/Max:     "Plan usage limits" (session bar) + "Weekly limits" bars
   *   - Enterprise:  "Your usage limits" (spend bar) + "Claude Code and Cowork
   *                  credit" + "Claude Design" allowance
   * Verified against the live claude.ai DOM. */
  function parseUsageDialog(dlg) {
    if (!dlg || !dlg.ownerDocument) return null; // graceful: bad/empty input
    try {
    const clean = (e) => (e.textContent || "").replace(/\s+/g, " ").trim();
    const isPctUsed = (s) => /^\d+%\s*used$/i.test(s);
    const isReset = (s) =>
      /^Resets\b/i.test(s) || /^Expir/i.test(s) || /haven['\u2019]?t used/i.test(s) || /^Starts when\b/i.test(s);
    // "$19.80 of $125.00 spent" -> { currency, spent, total }
    const spendOf = (s) => {
      const m = s.match(/^\s*([£$€])\s*([\d,]+(?:\.\d+)?)\s+of\s+([£$€])?\s*([\d,]+(?:\.\d+)?)/i);
      if (!m) return null;
      return { currency: m[1], spent: parseFloat(m[2].replace(/,/g, "")), total: parseFloat(m[4].replace(/,/g, "")) };
    };

    const walker = dlg.ownerDocument.createTreeWalker(dlg, NodeFilter.SHOW_ELEMENT);
    let n, section = null, plan = null, label = null, reset = null, spend = null, title = null;
    const plans = [], weekly = [], credits = [], designs = [];
    const bucket = () =>
      section === "week" ? weekly : section === "credit" ? credits : section === "design" ? designs : plans;
    const resetAcc = () => { label = reset = spend = null; };

    while ((n = walker.nextNode())) {
      if (n.getAttribute("role") === "progressbar" || n.getAttribute("role") === "meter") {
        if (!section) section = "plan";
        bucket().push({ label, reset, spend, title, pct: clampPct(+n.getAttribute("aria-valuenow")) });
        resetAcc();
        continue;
      }
      const isHeading = /^H[1-6]$/.test(n.tagName) || n.getAttribute("role") === "heading";
      if (n.childElementCount !== 0 && !isHeading) continue;
      const t = clean(n);
      if (!t) continue;

      // section headings — each starts a fresh accumulator
      if (/(Plan|Your) usage limits/i.test(t)) { section = "plan"; title = t; resetAcc(); const p = t.replace(/.*(Plan|Your) usage limits/i, "").trim(); if (p) plan = p; continue; }
      if (/^Weekly limits/i.test(t)) { section = "week"; title = t; resetAcc(); continue; }
      if (/Claude Code and Cowork credit|Usage credits/i.test(t)) { section = "credit"; title = t; resetAcc(); continue; }
      if (/^Claude Design/i.test(t)) { section = "design"; title = t; resetAcc(); continue; }

      // plan badge (e.g. the "Enterprise" chip next to the heading). Max carries
      // its tier multiplier in the badge -- "Max (20x)", "Max 5x" -- so the
      // suffix is optional here; planKey() normalises it back to "max".
      if (/^(Pro|Max|Team|Enterprise|Free)(\s*\(?\d+x\)?)?(\s*plan)?$/i.test(t)) { if (!plan) plan = t; continue; }

      // value lines
      const sp = spendOf(t); if (sp) { spend = sp; continue; }
      if (isPctUsed(t)) continue;
      if (isReset(t)) { reset = t; continue; }
      if (t.length <= 40 && !/£|\$|€|Last updated|Learn more|Refresh|Adjust|Buy|Turn on|Monthly spend|Current balance|one-time credit|separate allowance|draw from|applied before|\(\d+x\)/i.test(t)) label = t;
    }

    if (!plans.length && !weekly.length && !credits.length && !designs.length) return null;

    // Primary meter -> composer strip. Spend-based (Enterprise) or session (Pro/Max).
    const primary = plans[0] || null;
    let session = null;
    if (primary) {
      session = primary.spend
        ? { type: "spend", currency: primary.spend.currency, spent: primary.spend.spent, total: primary.spend.total, pct: primary.pct, reset: primary.reset || "" }
        : { type: "session", name: primary.label || "Current session", pct: primary.pct, reset: primary.reset || "" };
    }

    const design = designs.length
      ? { name: "Claude Design", pct: designs[0].pct, reset: designs[0].reset || "" }
      : null;

    // Sidebar card holds WEEKLY limits only (Pro/Max/Team). Enterprise has no
    // weekly limits, so this stays empty and the card is not shown — its numbers
    // (spend + credits) live under the composer instead. The credit sections are
    // parsed above but intentionally not surfaced in the side nav.
    const sidebar = weekly.map((w) => ({ name: w.label || "Usage", pct: w.pct, reset: w.reset || "" }));

    return { plan: planKey(plan), sidebar, session, design };
    } catch (_) { return null; } // graceful: never let a DOM shift throw into the scraper
  }

  // Only rewrite storage when the numbers actually changed (avoids re-render loops).
  const sigOf = (m) => JSON.stringify({ o: m.org, p: m.plan, s: m.session, w: m.sidebar, d: m.design });
  let lastSig = null;
  async function commit(base) {
    if (!base) return null;
    const sig = sigOf(Object.assign({ org: orgKey() }, base));
    if (sig === lastSig) return null;
    lastSig = sig;
    const model = Object.assign({}, base, { org: orgKey(), source: "scraped", updatedAt: Date.now() });
    await write(model);
    return model;
  }

  /* ===== 3. passive scrape (panel already open) ======================= */
  let lastScrapeAt = 0;
  async function scrapeUsage() {
    const now = Date.now();
    if (now - lastScrapeAt < 1200) return null;
    const dlg = usageDialogIn(document);
    if (!dlg) return null;
    lastScrapeAt = now;
    const base = parseUsageDialog(dlg);
    return base ? commit(base) : null;
  }

  /* ===== 3b. keeping out of the user's way ============================
   * HARD RULE: this extension never moves focus and never touches the
   * selection. An earlier attempt did exactly that — it snapshotted the caret
   * before a refresh and restored it every 120ms while the refresh iframe was
   * alive. Because the snapshot was taken once and the user kept typing, it
   * dragged the caret back a word or two, swallowed keystrokes and broke paste.
   * Repairing focus from the outside always races the person typing.
   *
   * So the iframe is stopped from taking focus in the first place (see the
   * pull), and refreshes simply stay away while someone is typing.
   * ================================================================== */
  const TYPING_IDLE_MS = 4000;
  let lastTypedAt = 0;
  try {
    ["keydown", "input", "paste", "compositionstart"].forEach(function (ev) {
      document.addEventListener(
        ev,
        function () { lastTypedAt = Date.now(); noteActivity(); },
        { capture: true, passive: true }
      );
    });
  } catch (_) {}

  // claude.ai keeps the composer focused almost permanently, so focus alone is
  // not a useful signal — deferring on it would mean never refreshing. Defer on
  // recent editing instead.
  function isUserTyping() {
    if (Date.now() - lastTypedAt > TYPING_IDLE_MS) return false;
    const el = document.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "TEXTAREA" || tag === "INPUT";
  }

  /* ===== 4. active pull (hidden frame) ================================
   * Measured in a browser, not assumed — of every way to hide a frame, ONLY
   * display:none stops the page inside it from taking focus:
   *
   *   offscreen + opacity:0   focus STOLEN
   *   inert                   focus STOLEN
   *   sandbox                 focus STOLEN
   *   visibility:hidden       focus STOLEN
   *   display:none            focus kept  <-- the only one
   *
   * The catch is that display:none gives the frame a 0x0 viewport, so a
   * responsive app may render its mobile layout, or nothing at all. Hence:
   *
   *   - background tab: nobody is typing, so use a normally rendered frame,
   *     which is the reliable way to get the panel to mount.
   *   - foreground tab: try the layout-less frame FIRST, since it cannot take
   *     focus. Only if the panel never appears there fall back to a rendered
   *     frame, and then only when the user is not typing — aborting the moment
   *     they start.
   *
   * Nothing in here touches focus or the selection. That was the previous
   * attempt, and restoring a caret snapshot on a timer fought the person typing.
   * ================================================================== */
  const SRC_SETTINGS = "https://claude.ai/settings/usage";   // no composer to autofocus
  const SRC_HASH = "https://claude.ai/new#settings/usage";   // fallback route
  let pulling = false, lastPullAt = 0;

  function makeFrame(noLayout, src) {
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("data-cus-probe", "1");
    f.setAttribute("tabindex", "-1");
    f.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1200px;height:900px;opacity:0;pointer-events:none;border:0";
    // The one mitigation that actually works: no layout box, so nothing inside
    // can be focused, so the user's caret is never disturbed.
    if (noLayout) f.style.display = "none";
    f.src = src;
    return f;
  }

  /* One attempt. Resolves to a committed model, or null. */
  async function attemptPull(noLayout, src, budgetMs) {
    const f = makeFrame(noLayout, src);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      document.body.appendChild(f);
      let waited = 0, toggled = false;
      while (waited < budgetMs) {
        await sleep(250); waited += 250;
        // A rendered frame CAN take focus, so if the user starts typing while
        // one is open, give up immediately rather than sit on their focus.
        if (!noLayout && isUserTyping()) return null;
        let doc;
        try { doc = f.contentDocument; } catch (_) { return null; } // cross-origin
        if (!doc) continue;
        const d = usageDialogIn(doc);
        if (d && d.querySelector('[role="progressbar"],[role="meter"]')) {
          const base = parseUsageDialog(d);
          return base ? commit(base) : null;
        }
        if (waited >= 1600 && !toggled) { // nudge the SPA into opening the panel
          toggled = true;
          try {
            f.contentWindow.location.hash = "#settings/general";
            await sleep(400);
            f.contentWindow.location.hash = "#settings/usage";
          } catch (_) {}
        }
      }
      return null;
    } catch (_) { return null; }
    finally { f.remove(); }
  }

  // A rendered frame CAN take focus, so it may only be used when the user is not
  // in this tab: another tab, another app, or minimised. Then focus theft is
  // invisible and costs nothing. `hidden` covers other-tab/minimised;
  // `hasFocus()` also covers "the window is behind another application".
  function userIsAway() {
    try { return document.hidden || !document.hasFocus(); } catch (_) { return false; }
  }

  async function pullUsage(opts) {
    opts = opts || {};
    const minGapMs = opts.minGapMs != null ? opts.minGapMs : 10000;
    const now = Date.now();
    if (pulling || now - lastPullAt < minGapMs) return null;
    if (location.origin !== "https://claude.ai") return null;
    pulling = true; lastPullAt = now;
    try {
      // ALWAYS the focus-safe frame first. Measured against live claude.ai from
      // the Claude Design page: it renders the usage panel in ~500ms even with a
      // 0x0 viewport, and takes no focus, so the composer is never touched. The
      // same frame rendered normally DID steal focus, which is the whole bug.
      const m = (await attemptPull(true, SRC_SETTINGS, 3500)) ||
                (await attemptPull(true, SRC_HASH, 3500));
      if (m) return m;
      // Only if the panel genuinely refuses to mount without a viewport, and
      // only while nobody is here to be interrupted.
      if (!userIsAway()) return null;
      return (await attemptPull(false, SRC_SETTINGS, 8000)) ||
             (await attemptPull(false, SRC_HASH, 12000));
    } finally { pulling = false; }
  }

  /* ===== 5. plan fallback ============================================= */
  function detectPlanFromDOM() {
    const t = (document.body && document.body.innerText || "").toLowerCase();
    if (t.includes("max plan") || /max\s*\(?\d+x/.test(t)) return "max";
    if (t.includes("enterprise")) return "enterprise";
    if (t.includes("team plan")) return "team";
    if (t.includes("pro plan")) return "pro";
    if (t.includes("free plan")) return "free";
    return "pro";
  }

  /* ===== 6. background loop =========================================== */
  // Keep the cache fresh without the user opening settings: when the data is
  // stale and the tab is visible, pull the Usage panel in a hidden iframe and
  // update storage (-> onChange -> re-render). Staleness-gating de-dupes across
  // multiple open tabs (first one to refresh wins).
  async function maybeRefresh() {
    if (USE_MOCK) return;
    if (usageDialogIn(document)) { await scrapeUsage(); return; } // panel open -> scrape directly
    const m = await read();
    // A switch makes even a seconds-old cache wrong, so refresh regardless of age.
    if (m && !orgMatches(m)) { await pullUsage({ minGapMs: 0 }); return; }
    if (isStale(m, freshnessMs())) await pullUsage();
  }

  let started = false;
  function startBackground() {
    if (started || USE_MOCK) return;
    started = true;
    maybeRefresh();                                  // fresh data on load if stale
    setInterval(maybeRefresh, TICK_MS);              // gated by freshnessMs()
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) noteActivity(); // coming back counts as activity
      maybeRefresh();
    });
    // Stepping away (another tab, another app, minimised) is the moment a fully
    // rendered refresh becomes free of consequences, so take it then.
    window.addEventListener("blur", function () { setTimeout(maybeRefresh, 250); });
  }

  // Called when the page knows the numbers just moved (a message was sent), so
  // the strip updates on the event instead of waiting for the next tick.
  function refreshSoon(delayMs) {
    noteActivity();
    let tries = 0;
    const attempt = async function () {
      if (usageDialogIn(document)) { scrapeUsage(); return; }
      const got = await pullUsage({ minGapMs: 0 });
      // null can mean "a pull is already running" or "deferred, user is typing";
      // retry a couple of times so a send-triggered refresh is not simply lost.
      if (!got && ++tries < 3) setTimeout(attempt, 3000);
    };
    setTimeout(attempt, delayMs == null ? 2500 : delayMs);
  }

  /* ===== 7. public entry ============================================= */
  async function fetchUsage() {
    if (USE_MOCK) return JSON.parse(JSON.stringify(MOCK[MOCK_PLAN] || MOCK.pro));
    return read(); // best available cached model (null until first scrape lands)
  }

  window.ClaudeUsageProvider = {
    fetchUsage,
    onChange,
    startBackground,
    scrapeUsage,
    pullUsage,
    parseUsageDialog,
    detectPlanFromDOM,
    refreshSoon,
    orgKey,
    isUserTyping,
  };
})();
