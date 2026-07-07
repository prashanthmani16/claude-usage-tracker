/* =============================================================================
 *  Claude Usage Stats — content script (UI + injection)
 *  ---------------------------------------------------------------------------
 *  Builds and maintains the three injected pieces:
 *    1. Sidebar "Weekly Usage limits" card  (above the profile in the side nav)
 *    2. Current-session strip                (behind the chat composer)
 *    3. Claude Design meter                  (behind the design composer)
 *
 *  Data comes from ClaudeUsageProvider.fetchUsage()  (see usage-provider.js).
 *
 *  HEADS UP ON SELECTORS: Claude's class names are hashed and change over time,
 *  so the finders use structural/heuristic strategies instead. If a piece is
 *  missing or lands in the wrong spot on the live site, tweak the matching
 *  finder in the "FINDERS" section — they're isolated and labelled.
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
      if (opts.html != null) e.innerHTML = opts.html;
      if (opts.attrs) for (var k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    }
    return e;
  }

  var STOPWATCH =
    '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M6.125 2H9.875M8 6.8V9.2M8 14C9.32608 14 10.5979 13.4943 11.5355 12.5941C12.4732 ' +
    "11.6939 13 10.473 13 9.2C13 7.92696 12.4732 6.70606 11.5355 5.80589C10.5979 4.90571 9.32608 " +
    "4.4 8 4.4C6.67392 4.4 5.40215 4.90571 4.46447 5.80589C3.52678 6.70606 3 7.92696 3 9.2C3 " +
    '10.473 3.52678 11.6939 4.46447 12.5941C5.40215 13.4943 6.67392 14 8 14Z" stroke="currentColor" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
      .replace(/^\s*(?:Resets\s+)?(?:in\s+)?/i, "") // drop leading "Resets" and/or "in"
      .replace(/\s*(?:GMT|UTC)\b.*$/i, "")
      .replace(/[\s,]+$/, "")
      .trim();
    if (!t || /haven'?t used|^starts when/i.test(t)) return "Not started yet";
    return t;
  }
  function makeReset(text) {
    var r = el("span", "cus-reset", { html: STOPWATCH });
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
  function buildStripRow(data, isDesign) {
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
      el("span", "cus-strip-pct", { text: isDesign ? data.pct + "%" : data.pct + "% used" })
    );
    row.appendChild(el("span", "cus-divider"));
    row.appendChild(makeReset(data.reset));
    return row;
  }
  function buildStatsLayer(data, isDesign) {
    var layer = el("div", "cus cus-stats-layer" + (isDesign ? " cus-stats-layer--design" : ""), {
      attrs: { "data-cus": isDesign ? "design" : "composer" },
    });
    layer.appendChild(buildStripRow(data, isDesign));
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

  // Claude Design surface? (chooses design data + styling). Tweak if needed.
  function isDesignPage() {
    return /(^|\/)design(\/|$)/i.test(location.pathname);
  }

  // The chat composer box (bordered container around the message input).
  function findComposer() {
    var input =
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

  // The sidebar profile footer row (avatar / name / plan) at the very bottom.
  // The card is inserted immediately BEFORE this row, so it pins to the bottom
  // of the sidebar just above the "<name> / <plan>" profile row — not at the top.
  function findSidebarFooter() {
    var sidebar =
      document.querySelector('[data-testid="menu-sidebar"]') ||
      document.querySelector("nav") ||
      document.body;
    var btns = [].slice.call(sidebar.querySelectorAll("button, a"));
    // Primary anchor: the bottom profile button labelled "<name>, Settings".
    var btn = btns.filter(function (b) {
      return /,\s*settings$/i.test(b.getAttribute("aria-label") || "");
    }).pop();
    // Fallback: the row that shows the plan name (Pro / Max / Team / Free).
    if (!btn) {
      btn = btns.filter(function (b) {
        return /(pro|max|team|free)\s*plan|enterprise/i.test(b.innerText || "");
      }).pop();
    }
    if (!btn) return null;
    // Climb to the footer row — a top-bordered container — but bounded, and
    // never up to the sidebar/nav root (which would push the card to the top).
    var row = btn;
    for (var i = 0; i < 6 && row.parentElement && row.parentElement !== sidebar; i++) {
      if (/border-t/.test("" + (row.className || ""))) break;
      row = row.parentElement;
    }
    return row;
  }

  // The Claude Design composer box (same heuristic — it also has an editable).
  function findDesignComposer() {
    return findComposer();
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
    var footer = findSidebarFooter();
    if (!footer || !footer.parentElement) return;
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
    } catch (e) {}
  }

  function injectLayer(data, isDesign) {
    var marker = isDesign ? "design" : "composer";
    var existing = document.querySelector('[data-cus="' + marker + '"]');
    var payload = isDesign ? data.design : data.session;
    if (!payload) {
      if (existing) existing.remove();
      return;
    }
    var composer = isDesign ? findDesignComposer() : findComposer();
    if (!composer || !composer.parentElement) return;
    var sig = sigOf(payload) + "|" + marker;
    var layer = existing;
    if (!(existing && existing.dataset.cusSig === sig && existing.previousElementSibling === composer)) {
      if (existing) existing.remove();
      layer = buildStatsLayer(payload, isDesign);
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

  function paint() {
    if (!lastData) return;
    applyTheme();
    injectSidebar(lastData);
    if (isDesignPage()) {
      var stray = document.querySelector('[data-cus="composer"]');
      if (stray) stray.remove();
      injectLayer(lastData, true);
    } else {
      var strayD = document.querySelector('[data-cus="design"]');
      if (strayD) strayD.remove();
      injectLayer(lastData, false);
    }
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
