"use strict";

// Core parser coverage: the claude DOM change (progressbar -> meter), backward
// compatibility, Enterprise spend, and the passive scrape -> cache -> fetch path.

const { test } = require("node:test");
const assert = require("node:assert");
const { loadProvider, makeDialog } = require("./helpers");
const { proMaxDialog, enterpriseDialog } = require("./fixtures");

test('parses the CURRENT role="meter" DOM (Pro/Max)', () => {
  const { window, provider } = loadProvider();
  const dlg = makeDialog(window, proMaxDialog("meter"));

  const model = provider.parseUsageDialog(dlg);

  assert.ok(model, "model should not be null");
  assert.equal(model.plan, "max");
  assert.deepEqual(model.session, {
    type: "session",
    name: "Current session",
    pct: 16,
    reset: "Resets in 3 hr 19 min",
  });
  assert.equal(model.sidebar.length, 2);
  assert.deepEqual(model.sidebar[0], {
    name: "All models",
    pct: 26,
    reset: "Resets in 18 hr 9 min",
  });
  assert.deepEqual(model.sidebar[1], {
    name: "Fable",
    pct: 38,
    reset: "Resets in 18 hr 9 min",
  });
  assert.equal(model.design, null);
});

test('still parses the LEGACY role="progressbar" DOM (regression guard)', () => {
  const { window, provider } = loadProvider();
  const dlg = makeDialog(window, proMaxDialog("progressbar"));

  const model = provider.parseUsageDialog(dlg);

  assert.ok(model);
  assert.equal(model.session.pct, 16);
  assert.equal(model.sidebar.length, 2);
  assert.equal(model.sidebar[1].pct, 38);
});

test("parses the Enterprise spend layout", () => {
  const { window, provider } = loadProvider();
  const dlg = makeDialog(window, enterpriseDialog("meter"));

  const model = provider.parseUsageDialog(dlg);

  assert.ok(model);
  assert.equal(model.plan, "enterprise");
  assert.equal(model.session.type, "spend");
  assert.equal(model.session.currency, "$");
  assert.equal(model.session.spent, 19.8);
  assert.equal(model.session.total, 125);
  assert.equal(model.session.pct, 16);
  assert.deepEqual(model.sidebar, [], "enterprise has no weekly sidebar card");
});

test("scrapeUsage reads an open panel, seeds the cache, and fetchUsage returns it", async () => {
  const { window, provider } = loadProvider();
  makeDialog(window, proMaxDialog("meter"));

  const committed = await provider.scrapeUsage();
  assert.ok(committed, "scrapeUsage should commit a model");
  assert.equal(committed.plan, "max");
  assert.equal(committed.source, "scraped");
  assert.ok(typeof committed.updatedAt === "number");

  const fetched = await provider.fetchUsage();
  assert.ok(fetched);
  assert.equal(fetched.sidebar.length, 2);
});
