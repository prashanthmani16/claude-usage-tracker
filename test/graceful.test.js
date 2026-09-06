"use strict";

// Graceful-exit coverage: the parser must return null (never throw) on missing,
// malformed, or partial DOM, and must clamp junk percentage values.

const { test } = require("node:test");
const assert = require("node:assert");
const { loadProvider, makeDialog } = require("./helpers");
const { bar } = require("./fixtures");

test("returns null (does not throw) for null / undefined / non-element input", () => {
  const { provider } = loadProvider();
  assert.equal(provider.parseUsageDialog(null), null);
  assert.equal(provider.parseUsageDialog(undefined), null);
  assert.equal(provider.parseUsageDialog({}), null);
  assert.equal(provider.parseUsageDialog(42), null);
});

test("returns null for a usage dialog that has no bars yet (still loading)", () => {
  const { window, provider } = loadProvider();
  const dlg = makeDialog(
    window,
    "<h2>Plan usage limits</h2><span>Loading…</span>"
  );
  assert.equal(provider.parseUsageDialog(dlg), null);
});

test("clamps out-of-range and missing aria-valuenow to 0..100", () => {
  const { window, provider } = loadProvider();
  const dlg = makeDialog(
    window,
    [
      "<h2>Plan usage limits</h2>",
      "<span>Current session</span>",
      bar("meter", 150), // above 100 -> 100
      "<h2>Weekly limits</h2>",
      "<span>Under</span>",
      bar("meter", -5), // below 0 -> 0
      "<span>Missing</span>",
      bar("meter", null), // no aria-valuenow -> 0
    ].join("")
  );

  const model = provider.parseUsageDialog(dlg);
  assert.ok(model);
  assert.equal(model.session.pct, 100);
  assert.equal(model.sidebar[0].pct, 0);
  assert.equal(model.sidebar[1].pct, 0);
});

test("fetchUsage returns null when nothing has been scraped yet", async () => {
  const { provider } = loadProvider();
  const empty = await provider.fetchUsage();
  assert.equal(empty, null);
});

test("detectPlanFromDOM falls back via page body text", () => {
  const { window, provider } = loadProvider();
  window.document.body.innerHTML = "<div>Max plan</div>";
  assert.equal(provider.detectPlanFromDOM(), "max");
  window.document.body.innerHTML = "<div>nothing relevant</div>";
  assert.equal(provider.detectPlanFromDOM(), "pro"); // safe default
});

/* ---------------------------------------------------------------------------
 * Refresh must never fight the user for focus. The refresh iframe loads
 * claude.ai's own app, which autofocuses its composer; focusing inside a
 * same-origin iframe moves the browser's focus there, yanking the caret out of
 * whatever was being typed.
 * ------------------------------------------------------------------------- */

test("a refresh is deferred while the user is actively typing", async () => {
  const { window, provider } = loadProvider();
  try {
    const input = window.document.createElement("textarea");
    window.document.body.appendChild(input);
    input.focus();

    // no recent keystroke -> not considered typing, even with focus held
    assert.equal(provider.isUserTyping(), false, "idle focus must not block refreshes");

    // a keystroke starts a typing burst
    window.document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "a", bubbles: true })
    );
    assert.equal(provider.isUserTyping(), true, "mid-burst typing must block refreshes");

    // and the pull bails out without ever creating its iframe
    const before = window.document.querySelectorAll("iframe").length;
    const result = await provider.pullUsage({ minGapMs: 0 });
    assert.equal(result, null, "pull must defer, not run");
    assert.equal(
      window.document.querySelectorAll("iframe").length,
      before,
      "no iframe may be created while typing"
    );
  } finally {
    window.close();
  }
});

test("focus and caret are restored after being taken away", () => {
  const { window, provider } = loadProvider();
  try {
    const input = window.document.createElement("textarea");
    input.value = "half-written sentence";
    window.document.body.appendChild(input);
    const other = window.document.createElement("textarea");
    window.document.body.appendChild(other);

    input.focus();
    input.setSelectionRange(5, 5);
    const snap = provider.captureFocus();

    other.focus(); // stand-in for the iframe stealing focus
    assert.equal(window.document.activeElement, other);

    provider.restoreFocus(snap);
    assert.equal(window.document.activeElement, input, "focus must come back");
    assert.equal(input.selectionStart, 5, "and the caret with it");
  } finally {
    window.close();
  }
});

test("restoring focus to a removed element does not throw", () => {
  const { window, provider } = loadProvider();
  try {
    const input = window.document.createElement("textarea");
    window.document.body.appendChild(input);
    input.focus();
    const snap = provider.captureFocus();
    input.remove(); // the composer unmounted mid-refresh
    assert.doesNotThrow(() => provider.restoreFocus(snap));
  } finally {
    window.close();
  }
});
