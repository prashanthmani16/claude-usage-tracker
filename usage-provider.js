/* =============================================================================
 *  Claude Usage Stats — DATA PROVIDER  (real-data background auto-pull)
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

  /* ===== 1. storage cache + cross-tab sync ============================= */
  const KEY = "cus:model";
  const FRESH_MS = 30 * 1000; // pull fresh numbers when the cache is older than this

  function read() {
    return new Promise((res) => {
      try { chrome.storage.local.get(KEY, (o) => res((o && o[KEY]) || null)); }
      catch (_) { res(null); }
    });
  }
  function write(model) {
    return new Promise((res) => {
      try { chrome.storage.local.set({ [KEY]: model }, res); } catch (_) { res(); }
    });
  }
  function onChange(cb) {
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (area === "local" && ch[KEY]) cb(ch[KEY].newValue || null);
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
    const clean = (e) => (e.textContent || "").replace(/\s+/g, " ").trim();
    const isPctUsed = (s) => /^\d+%\s*used$/i.test(s);
    const isReset = (s) => /^Resets\b/i.test(s) || /^Expir/i.test(s) || /haven'?t used/i.test(s);
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
      if (n.getAttribute("role") === "progressbar") {
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

      // plan badge (e.g. the "Enterprise" chip next to the heading)
      if (/^(Pro|Max|Team|Enterprise|Free)(\s*plan)?$/i.test(t)) { if (!plan) plan = t; continue; }

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
  }

  // Only rewrite storage when the numbers actually changed (avoids re-render loops).
  const sigOf = (m) => JSON.stringify({ p: m.plan, s: m.session, w: m.sidebar, d: m.design });
  let lastSig = null;
  async function commit(base) {
    if (!base) return null;
    const sig = sigOf(base);
    if (sig === lastSig) return null;
    lastSig = sig;
    const model = Object.assign({}, base, { source: "scraped", updatedAt: Date.now() });
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

  /* ===== 4. active pull (hidden same-origin iframe) =================== */
  let pulling = false, lastPullAt = 0;
  async function pullUsage(opts) {
    opts = opts || {};
    const minGapMs = opts.minGapMs != null ? opts.minGapMs : 20000;
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 16000;
    const now = Date.now();
    if (pulling || now - lastPullAt < minGapMs) return null;
    if (location.origin !== "https://claude.ai") return null;
    pulling = true; lastPullAt = now;

    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("data-cus-probe", "1");
    f.style.cssText = "position:fixed;left:-9999px;top:0;width:1200px;height:900px;opacity:0;pointer-events:none;border:0";
    f.src = "https://claude.ai/new#settings/usage";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      document.body.appendChild(f);
      let dlg = null, waited = 0, toggled = false;
      while (waited < timeoutMs) {
        await sleep(800); waited += 800;
        let doc;
        try { doc = f.contentDocument; } catch (_) { break; } // cross-origin (shouldn't happen)
        if (!doc) continue;
        const d = usageDialogIn(doc);
        if (d && d.querySelector('[role="progressbar"]')) { dlg = d; break; }
        if (waited >= 4800 && !toggled) { // nudge the SPA to open the panel if needed
          toggled = true;
          try { f.contentWindow.location.hash = "#settings/general"; await sleep(600); f.contentWindow.location.hash = "#settings/usage"; } catch (_) {}
        }
      }
      if (!dlg) return null;
      const base = parseUsageDialog(dlg);
      return base ? commit(base) : null;
    } catch (_) { return null; }
    finally { f.remove(); pulling = false; }
  }

  /* ===== 5. plan fallback ============================================= */
  function detectPlanFromDOM() {
    const t = (document.body && document.body.innerText || "").toLowerCase();
    if (t.includes("max plan")) return "max";
    if (t.includes("enterprise")) return "enterprise";
    if (t.includes("team plan")) return "team";
    if (t.includes("pro plan")) return "pro";
    return "pro";
  }

  /* ===== 6. background loop =========================================== */
  // Keep the cache fresh without the user opening settings: when the data is
  // stale and the tab is visible, pull the Usage panel in a hidden iframe and
  // update storage (-> onChange -> re-render). Staleness-gating de-dupes across
  // multiple open tabs (first one to refresh wins).
  async function maybeRefresh() {
    if (USE_MOCK || document.hidden) return;
    if (usageDialogIn(document)) { await scrapeUsage(); return; } // panel open -> scrape directly
    const m = await read();
    if (isStale(m, FRESH_MS)) await pullUsage();
  }

  let started = false;
  function startBackground() {
    if (started || USE_MOCK) return;
    started = true;
    maybeRefresh();                                  // fresh data on load if stale
    setInterval(maybeRefresh, FRESH_MS);             // and periodically while open
    document.addEventListener("visibilitychange", maybeRefresh);
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
  };
})();
