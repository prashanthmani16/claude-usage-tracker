"use strict";

/* ---------------------------------------------------------------------------
 * PER-PLAN DISPLAY MATRIX
 *
 * Locks what each plan is supposed to show. Runs the whole chain for real:
 * the plan's Settings → Usage DOM goes through the actual parser, and the
 * resulting model is rendered by the actual content script, so a break in
 * either half fails here.
 *
 * Nothing keys off `model.plan` — the display is driven purely by the SHAPE of
 * what a plan exposes:
 *
 *   weekly bars present -> sidebar card, one meter per bar
 *   session primary     -> strip reads "<name> · N% used"
 *   spend primary       -> strip reads "Spend $X / $Y · N% used"
 *   design allowance    -> its own strip, on the design surface only
 * ------------------------------------------------------------------------- */

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadProvider, makeDialog, loadExtension } = require("./helpers");
const {
  freeDialog, proDialog, maxTierDialog, teamDialog,
  enterpriseDialog, enterpriseFullDialog, sidebarShell, composerShell,
} = require("./fixtures");

// Parse a plan's dialog with the real provider, exactly as the scraper would.
function modelFor(dialogHtml) {
  const { window, provider } = loadProvider();
  try {
    const model = provider.parseUsageDialog(makeDialog(window, dialogHtml));
    // The model is built inside the jsdom realm, so its objects carry that
    // realm's prototypes and assert.deepEqual's prototype check fails against
    // identical-looking literals here. Round-trip it into this realm.
    return model && JSON.parse(JSON.stringify(model));
  } finally {
    window.close();
  }
}

// Render a model over a full shell (sidebar + composer) and read the display.
async function render(model, path) {
  const ext = await loadExtension({
    html: sidebarShell() + composerShell(672),
    model,
    path,
  });
  const norm = (n) => (n ? n.textContent.replace(/\s+/g, " ").trim() : null);
  const view = {
    cardMeters: ext.card()
      ? [...ext.card().querySelectorAll(".cus-meter")].map((m) => ({
          name: m.querySelector(".cus-meter-name").textContent,
          pct: m.querySelector(".cus-meter-pct").textContent,
        }))
      : null,
    strip: norm(ext.strip()),
    designStrip: norm(ext.designStrip()),
  };
  await ext.close();
  return view;
}

/* ===== the four plan tiers that expose a session + weekly limits ========= */

test("FREE — session strip, and no card (free has no weekly limits)", async () => {
  const model = modelFor(freeDialog());
  assert.equal(model.plan, "free", "free must not be mislabelled as pro");
  assert.deepEqual(model.sidebar, [], "free exposes no weekly bars");
  assert.deepEqual(model.session, {
    type: "session", name: "Current session", pct: 48, reset: "Resets in 2 hr 5 min",
  });

  const view = await render(model);
  assert.equal(view.cardMeters, null, "no weekly limits -> no sidebar card");
  assert.match(view.strip, /Current session/);
  assert.match(view.strip, /48% used/);
});

test("PRO — session strip + a one-meter weekly card", async () => {
  const model = modelFor(proDialog());
  assert.equal(model.plan, "pro");
  assert.equal(model.session.pct, 22);

  const view = await render(model);
  assert.deepEqual(view.cardMeters, [{ name: "All models", pct: "55%" }]);
  assert.match(view.strip, /Current session/);
  assert.match(view.strip, /22% used/);
});

test("MAX — tier multiplier does not leak, two weekly meters", async () => {
  const model = modelFor(maxTierDialog());
  assert.equal(model.plan, "max", '"Max (20x)" must resolve to max');
  // The "(20x)" chip sits right where a meter label would be read from.
  assert.equal(model.session.name, "Current session");
  assert.ok(
    !JSON.stringify(model).includes("20x"),
    "the tier multiplier must not leak into any label"
  );

  const view = await render(model);
  assert.deepEqual(view.cardMeters, [
    { name: "All models", pct: "26%" },
    { name: "Fable", pct: "38%" },
  ]);
  assert.match(view.strip, /16% used/);
});

test("TEAM — session strip + weekly card, promo blurb excluded", async () => {
  const model = modelFor(teamDialog());
  assert.equal(model.plan, "team");

  const view = await render(model);
  assert.deepEqual(view.cardMeters, [
    { name: "All models", pct: "1%" },
    { name: "Fable", pct: "0%" },
  ]);
  // The boost blurb and "Learn more" row must not become meters.
  assert.equal(view.cardMeters.length, 2, "promo copy must not add a meter");
  assert.match(view.strip, /7% used/);
});

/* ===== enterprise: spend instead of a session, no weekly card =========== */

test("ENTERPRISE — spend strip, no card", async () => {
  const model = modelFor(enterpriseDialog());
  assert.equal(model.plan, "enterprise");
  assert.equal(model.session.type, "spend");

  const view = await render(model);
  assert.equal(view.cardMeters, null, "enterprise has no weekly limits -> no card");
  assert.match(view.strip, /Spend \$19\.80 \/ \$125\.00/);
  assert.match(view.strip, /16% used/);
});

test("ENTERPRISE (full) — spend + credit parsed, Design kept separate", async () => {
  const model = modelFor(enterpriseFullDialog());

  // The primary meter is the plan spend, NOT the Claude Code credit that
  // follows it in the same dialog.
  assert.equal(model.session.type, "spend");
  assert.equal(model.session.spent, 80.65);
  assert.equal(model.session.total, 125);
  assert.equal(model.session.pct, 65);
  // Design is its own allowance, on its own surface.
  assert.deepEqual(model.design, {
    name: "Claude Design", pct: 99, reset: "Expires July 18",
  });
  assert.deepEqual(model.sidebar, [], "credit is not surfaced in the side nav");

  // On a chat page: the spend strip, and no design strip.
  const chat = await render(model, "/new");
  assert.match(chat.strip, /Spend \$80\.65 \/ \$125\.00/);
  assert.equal(chat.designStrip, null, "design must not paint on a chat page");

  // On the design surface: the design strip instead, with "Expires" tidied off.
  const design = await render(model, "/design");
  assert.equal(design.strip, null, "the session strip yields to design here");
  assert.match(design.designStrip, /Claude Design/);
  assert.match(design.designStrip, /99%/);
  assert.match(design.designStrip, /July 18/);
});

/* ===== every plan survives the legacy progressbar DOM =================== */

test("every plan parses under the LEGACY progressbar role too", () => {
  const cases = {
    free: [freeDialog("progressbar"), 0],
    pro: [proDialog("progressbar"), 1],
    max: [maxTierDialog("progressbar"), 2],
    team: [teamDialog("progressbar"), 2],
    enterprise: [enterpriseFullDialog("progressbar"), 0],
  };
  for (const [plan, [html, weeklyCount]] of Object.entries(cases)) {
    const m = modelFor(html);
    assert.ok(m, `${plan}: legacy DOM must still parse`);
    assert.equal(m.plan, plan, `${plan}: plan key`);
    assert.equal(m.sidebar.length, weeklyCount, `${plan}: weekly meter count`);
    assert.ok(m.session, `${plan}: must expose a primary meter`);
  }
});
