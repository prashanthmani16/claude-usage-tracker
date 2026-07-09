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
