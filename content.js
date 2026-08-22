/* =============================================================================
 *  Claude Usage Stats — content script (UI + injection)
 *  ---------------------------------------------------------------------------
 *  Builds and maintains the three injected pieces:
 *    1. Sidebar "Weekly Usage limits" card  (above the side nav's bottom tray)
 *    2. Current-session strip                (behind the chat composer)
 *
 *  Claude Design (claude.ai/design) is a different product on the same origin
 *  and is deliberately left alone — nothing is painted there.
 *
 *  Data comes from ClaudeUsageProvider.fetchUsage()  (see usage-provider.js).
 *
 *  HEADS UP ON SELECTORS: Claude's utility classes are hashed and change over
 *  time, so the finders use structural/heuristic strategies instead. The one
 *  exception is the app shell's own `dframe-*` / `df-*` classes (sidebar, bottom
 *  tray, footer row), which are semantic and stable enough to anchor on — every
 *  such use below is backed by a fallback. If a piece is missing or lands in the
 *  wrong spot on the live site, tweak the matching finder in the "FINDERS"
 *  section — they're isolated and labelled.
 * ========================================================================== */
(function () {
  "use strict";
  var TAG = "[ClaudeUsageStats]";

  /* ---------------- tiny DOM helper ---------------- */
  function el(tag, cls, opts) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (opts) {
      if (opts.text != null) e.textContent = opts.text;
      if (opts.attrs) for (var k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    }
    return e;
  }

  // Stopwatch glyph, built as SVG DOM rather than a markup string: assigning
  // markup through innerHTML trips AMO's "unsafe assignment" check even when
  // the value is a hard-coded constant.
  var SVG_NS = "http://www.w3.org/2000/svg";
  var STOPWATCH_PATH =
    "M6.125 2H9.875M8 6.8V9.2M8 14C9.32608 14 10.5979 13.4943 11.5355 12.5941C12.4732 " +
    "11.6939 13 10.473 13 9.2C13 7.92696 12.4732 6.70606 11.5355 5.80589C10.5979 4.90571 9.32608 " +
    "4.4 8 4.4C6.67392 4.4 5.40215 4.90571 4.46447 5.80589C3.52678 6.70606 3 7.92696 3 9.2C3 " +
    "10.473 3.52678 11.6939 4.46447 12.5941C5.40215 13.4943 6.67392 14 8 14Z";

  function stopwatchIcon() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", STOPWATCH_PATH);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    return svg;
  }

  /* ---------------- component builders ---------------- */
  function makeBar(pct) {
    var bar = el("div", "cus-bar");
    var fill = el("div", "cus-bar-fill");
    if (Number(pct) >= 100) fill.classList.add("cus-red");
    fill.style.width = Math.max(0, Math.min(Number(pct) || 0, 100)) + "%";
    bar.appendChild(fill);
    return bar;
  }
  // Normalize the reset/status text for display: drop the leading "Resets"
  // verb and any trailing timezone (e.g. "GMT+5:30"); collapse the "no usage
  // yet" states — an empty reset or "You haven't used X yet" — into a single
  // "Not started yet" label.
  function tidyReset(text) {
    var t = String(text == null ? "" : text)
      .replace(/^\s*(?:(?:Resets|Expires?)\s+)?(?:in\s+)?/i, "") // drop leading "Resets"/"Expires"/"in"
      .replace(/\s*(?:GMT|UTC)\b.*$/i, "")
      .replace(/[\s,]+$/, "")
      .trim();
    if (!t || /haven['\u2019]?t used|^starts when/i.test(t)) return "Not started yet";
    return t;
  }
  function makeReset(text) {
    var r = el("span", "cus-reset");
    r.appendChild(stopwatchIcon());
    r.appendChild(el("span", null, { text: tidyReset(text) }));
    return r;
  }

  // 1. sidebar card
  function buildSidebarCard(meters) {
    var card = el("div", "cus cus-card", { attrs: { "data-cus": "sidebar" } });
    card.appendChild(el("div", "cus-card-label", { text: "Weekly Usage limits" }));
    meters.forEach(function (m) {
      var meter = el("div", "cus-meter");
      meter.appendChild(el("span", "cus-meter-name", { text: m.name }));
      var row = el("div", "cus-bar-row");
      row.appendChild(makeBar(m.pct));
      row.appendChild(el("span", "cus-meter-pct", { text: m.pct + "%" }));
      meter.appendChild(row);
      meter.appendChild(makeReset(m.reset));
      card.appendChild(meter);
    });
    return card;
  }

  // 2 & 3. the strip row inside a stats layer
  function buildStripRow(data) {
    var row = el("div", "cus-strip-row");
    var label =
      data.type === "spend"
        ? "Spend " +
          data.currency +
          Number(data.spent).toFixed(2) +
          " / " +
          data.currency +
          Number(data.total).toFixed(2)
        : data.name;
    row.appendChild(el("span", "cus-strip-label", { text: label }));
    row.appendChild(makeBar(data.pct));
    row.appendChild(
      el("span", "cus-strip-pct", { text: data.pct + "% used" })
    );
    row.appendChild(el("span", "cus-divider"));
    row.appendChild(makeReset(data.reset));
    return row;
  }
  function buildStatsLayer(data) {
    var layer = el("div", "cus cus-stats-layer", { attrs: { "data-cus": "composer" } });
    layer.appendChild(buildStripRow(data));
    return layer;
  }

  /* ---------------- theme (mirror Claude's light/dark) ---------------- */
  function isDark() {
    try {
      var m = (getComputedStyle(document.body).backgroundColor || "").match(/\d+/g);
      if (m && m.length >= 3) {
        var r = +m[0], g = +m[1], b = +m[2];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
      }
    } catch (e) {}
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function applyTheme() {
    document.documentElement.classList.toggle("cus-theme-dark", isDark());
  }

  /* =========================================================================
   *  FINDERS  — adjust here if injection misses on the live site
   * ====================================================================== */

  // Claude Design (claude.ai/design) is a separate product that happens to share
  // the origin, so the content script loads there too. Nothing is painted on it:
  // these stats belong to claude.ai proper. Checked at runtime rather than with
  // manifest exclude_matches, because the script has to keep running for an SPA
  // navigation BACK to a chat page.
  function isDesignSurface() {
    return /^\/design(\/|$)/i.test(location.pathname);
  }

  // Screens that are not the app: sign-in, magic-link/verification, sign-out,
  // OAuth/SSO consent. They carry no composer and no side nav, but a cached
  // model would still happily paint onto whatever stub they do render.
  function isAppSurface() {
    return !/^\/(login|logout|verify|magic|auth|oauth|sso)\b/i.test(location.pathname);
  }

  // Is this composer something we can safely pin the strip to? During the
  // initial splash — and on auth/error screens — claude.ai renders a stub that
  // is only a few px wide; pinning to it collapsed the strip into a tall pill
  // with the text spilling outside it.
  var MIN_COMPOSER_W = 280;
  function isUsableComposer(el) {
    if (!el || !el.parentElement) return false;
    var r = el.getBoundingClientRect();
    return r.width >= MIN_COMPOSER_W && r.height > 0;
  }

  // The chat composer box (bordered container around the message input).
  // Prefers the editable on the chat surface; the bare selector stays as a
  // fallback so other composer surfaces (e.g. Design) still resolve.
  function findComposer() {
    var input =
      document.querySelector('main div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("main textarea");
    if (!input) return null;
    var node = input;
    for (var i = 0; i < 8 && node.parentElement; i++) {
      node = node.parentElement;
      var cs = getComputedStyle(node);
      if (parseFloat(cs.borderTopWidth) > 0 && parseInt(cs.borderTopLeftRadius) >= 8) return node;
      if (node.tagName === "FORM" || node.tagName === "FIELDSET") return node;
    }
    return input.parentElement;
  }

  // The side nav root — used both to scope the footer search and to measure the
  // collapsed/expanded width. Claude's current shell is an
  // <aside class="dframe-sidebar"> wrapping a [data-testid="sidebar"] body; it
  // has no <nav> element at all. The older <nav> / [data-testid="menu-sidebar"]
  // selectors are kept last as fallbacks for stale builds.
  function findSidebarRoot() {
    return (
      document.querySelector("aside.dframe-sidebar") ||
      document.querySelector('[data-testid="sidebar"]') ||
      document.querySelector('[data-testid="menu-sidebar"]') ||
      document.querySelector("nav")
    );
  }

  // The element the card is inserted immediately BEFORE, which pins the card to
  // the bottom of the side nav rather than the top.
  //
  // The card goes INSIDE .df-bottom-tray, as its first child — above the
  // products row ("Design") and the "<name> · <org>" profile row both. Being
  // inside the tray matters for more than order: the divider above Design is
  // the tray's own ::before, drawn at the tray's top edge, so a card inside the
  // tray sits below that divider instead of above it. The result reads
  // divider / card / Design / divider / profile.
  function findSidebarFooter() {
    // No side nav at all on this surface (Claude Design has none). Without this
    // the last-resort branch below anchored on <body> and stretched the card to
    // the full page width, off-screen.
    var root = findSidebarRoot();
    if (!root) return null;
    // Current shell: first child of the tray, i.e. just above the products row.
    var products = root.querySelector(".df-bottom-tray .df-products-block");
    if (products) return products;
    // No products row (accounts without those products): still inside the tray,
    // just above the profile row, so the tray's divider stays above the card.
    var footerInTray = root.querySelector(".df-bottom-tray .df-footer-row");
    if (footerInTray) return footerInTray;
    // Tray inner classes renamed: sit above the whole tray. Correct placement,
    // though the tray's divider then falls below the card rather than above it.
    var tray = root.querySelector(".df-bottom-tray");
    if (tray) return tray;
    // Tray itself renamed: fall back to the profile row wherever it lives.
    var footer = root.querySelector(".df-footer-row");
    if (footer) return footer;
    // Legacy shells: anchor on the profile button, then climb to its row.
    var btns = [].slice.call(root.querySelectorAll("button, a"));
    // The bottom profile button used to be labelled "<name>, Settings".
    var btn = btns.filter(function (b) {
      return /,\s*settings$/i.test(b.getAttribute("aria-label") || "");
    }).pop();
    // Fallback: the row that shows the plan name (Pro / Max / Team / Free).
    if (!btn) {
      btn = btns.filter(function (b) {
        return /(pro|max|team|free)\s*plan|enterprise/i.test(b.innerText || "");
      }).pop();
    }
    if (btn) {
      // Climb to the footer row — a top-bordered container — but bounded, and
      // never up to the sidebar root (which would push the card to the top).
      var row = btn;
      for (var i = 0; i < 6 && row.parentElement && row.parentElement !== root; i++) {
        if (/border-t/.test("" + (row.className || ""))) break;
        row = row.parentElement;
      }
      return row;
    }
    // Last resort: anchor on the bottom-most block of the sidebar body, so a
    // future rename of .df-footer-row degrades to "card at the bottom of the
    // sidebar" rather than no card at all (the failure this whole finder had).
    var body = root.querySelector('[data-testid="sidebar"]') || root;
    var anchor = body.querySelector(".df-bottom-tray") || body.lastElementChild;
    return anchor && anchor.parentElement ? anchor : null;
  }

  /* =========================================================================
   *  INJECTION  (idempotent: cheap to re-run; replaces only when data changes)
   * ====================================================================== */
  function sigOf(obj) {
    try { return JSON.stringify(obj); } catch (e) { return "" + Math.random(); }
  }

  function injectSidebar(data) {
    var existing = document.querySelector('[data-cus="sidebar"]');
    if (!data.sidebar || !data.sidebar.length) {
      if (existing) existing.remove();
      return;
    }
    // When the side nav is collapsed to the icon rail it's too narrow for the
    // card, so hide it (the composer strip is unaffected).
    var nav = findSidebarRoot();
    if (nav && nav.getBoundingClientRect().width < 120) {
      if (existing) existing.remove();
      return;
    }
    var footer = findSidebarFooter();
    if (!footer || !footer.parentElement) {
      if (existing) existing.remove(); // e.g. navigating into Claude Design
      return;
    }
    var sig = sigOf(data.sidebar);
    if (existing && existing.dataset.cusSig === sig && existing.nextElementSibling === footer) return;
    if (existing) existing.remove();
    var card = buildSidebarCard(data.sidebar);
    card.dataset.cusSig = sig;
    footer.parentElement.insertBefore(card, footer);
  }

  // Pin the strip to the composer's exact width + horizontal position so it
  // tucks directly under the composer, instead of spanning the wider parent and
  // spilling past the composer's edge. Measures the live rendered boxes, so it
  // works whether Claude lays the composer out as a block or a flex item.
  function alignLayerToComposer(layer, composer) {
    try {
      var cw = composer.getBoundingClientRect().width;
      layer.style.width = cw + "px";
      layer.style.left = "0px"; // reset before measuring natural position
      var delta = composer.getBoundingClientRect().left - layer.getBoundingClientRect().left;
      layer.style.left = delta + "px"; // position:relative nudge (set in CSS)
      // CSS pulls the layer's top up behind the composer. That used to be hidden
      // with z-index:-1, but claude.ai now isolates the composer's container,
      // which traps a negative z-index below the in-context backgrounds. So the
      // layer paints normally and the overlapping strip of it is CLIPPED away --
      // same look, no stacking games. Measured live, so it holds however tall
      // the composer grows.
      var overlap = Math.round(
        composer.getBoundingClientRect().bottom - layer.getBoundingClientRect().top
      );
      layer.style.clipPath = overlap > 0 ? "inset(" + overlap + "px 0 0 0)" : "none";
    } catch (e) {}
  }

  function injectLayer(data) {
    var existing = document.querySelector('[data-cus="composer"]');
    var payload = data.session;
    if (!payload) {
      if (existing) existing.remove();
      return;
    }
    var composer = findComposer();
    // No usable composer -> REMOVE any layer we left behind rather than
    // returning. Returning here is what orphaned the strip on screens the SPA
    // navigated to after the composer unmounted, leaving a broken pill behind.
    if (!isUsableComposer(composer)) {
      if (existing) existing.remove();
      return;
    }
    var sig = sigOf(payload) + "|composer";
    var layer = existing;
    if (!(existing && existing.dataset.cusSig === sig && existing.previousElementSibling === composer)) {
      if (existing) existing.remove();
      layer = buildStatsLayer(payload);
      layer.dataset.cusSig = sig;
      composer.insertAdjacentElement("afterend", layer);
    }
    alignLayerToComposer(layer, composer); // keep aligned even when data is unchanged
  }

  /* ---------------- orchestration ---------------- */
  var lastData = null;
  async function refreshData() {
    try {
      lastData = await window.ClaudeUsageProvider.fetchUsage();
    } catch (e) {
      console.warn(TAG, "fetchUsage() failed:", e);
    }
  }

  // Repaint the instant the side nav resizes (collapse/expand). Without this the
  // card only re-evaluates on the 2s safety tick, so it lingers broken in the
  // narrow rail for a couple seconds before hiding.
  var _navRO = null, _watchedNav = null;
  function watchNav() {
    if (typeof ResizeObserver === "undefined") return;
    var nav = findSidebarRoot();
    if (!nav || nav === _watchedNav) return;
    if (!_navRO) _navRO = new ResizeObserver(schedule);
    if (_watchedNav) _navRO.unobserve(_watchedNav);
    _navRO.observe(nav);
    _watchedNav = nav;
  }

  function removeAllInjected() {
    ["sidebar", "composer", "design"].forEach(function (k) {
      var n = document.querySelector('[data-cus="' + k + '"]');
      if (n) n.remove();
    });
  }

  function paint() {
    if (!lastData) return;
    applyTheme();
    // Sign-in / verification / error screens, and Claude Design: paint nothing,
    // and clear anything already painted, so cached numbers can't linger over a
    // splash screen or bleed into a product these stats don't belong to.
    if (!isAppSurface() || isDesignSurface()) {
      removeAllInjected();
      return;
    }
    watchNav();
    injectSidebar(lastData);
    injectLayer(lastData);
  }

  /* ---------------- lifecycle ---------------- */
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      paint();
    });
  }

  async function start() {
    await refreshData();
    paint();

    // background auto-pull: keep the cache fresh (hidden-iframe scrape of
    // Settings → Usage) and re-paint when fresh numbers land — including from
    // another claude.ai tab, via chrome.storage cross-tab sync.
    if (window.ClaudeUsageProvider.onChange)
      window.ClaudeUsageProvider.onChange(function (m) { if (m) { lastData = m; schedule(); } });
    if (window.ClaudeUsageProvider.startBackground)
      window.ClaudeUsageProvider.startBackground();

    // re-inject as Claude re-renders / navigates
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

    // re-align the strip to the composer when the viewport size changes
    window.addEventListener("resize", schedule);

    // SPA route changes
    window.addEventListener("popstate", schedule);
    var _ps = history.pushState;
    history.pushState = function () { _ps.apply(this, arguments); schedule(); };
    var _rs = history.replaceState;
    history.replaceState = function () { _rs.apply(this, arguments); schedule(); };

    // theme changes
    if (window.matchMedia) {
      var mq = matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", applyTheme);
    }

    // refresh numbers over time + safety re-paint in case a mutation was missed
    setInterval(async function () { await refreshData(); paint(); }, 60 * 1000);
    setInterval(schedule, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
