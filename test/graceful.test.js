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



/* ---------------------------------------------------------------------------
 * Organisation switching. One account can hold several orgs with separate
 * limits (a Team and an Enterprise), so cached numbers belong to exactly one of
 * them and must never be shown under another.
 * ------------------------------------------------------------------------- */

function withOrgLabel(window, label) {
  window.document.body.innerHTML =
    '<div class="df-footer-row"><button>MB</button><span>' + label + "</span></div>";
}

test("numbers cached under one org are not served to another", async () => {
  const { window, provider, chrome } = loadProvider();
  try {
    withOrgLabel(window, "Manikandan B · Zohocorp");
    const teamOrg = provider.orgKey();
    assert.ok(teamOrg, "an org key must be derivable from the profile row");

    chrome.__store["cus:model"] = {
      org: teamOrg, plan: "team", sidebar: [], session: { type: "session", pct: 7 },
      updatedAt: Date.now(),
    };
    assert.equal((await provider.fetchUsage()).plan, "team", "same org: served");

    withOrgLabel(window, "Manikandan B · Zoho India");
    assert.notEqual(provider.orgKey(), teamOrg, "the switch must change the key");
    assert.equal(await provider.fetchUsage(), null, "other org's numbers must not be served");
  } finally {
    window.close();
  }
});

test("switching back serves that org's last numbers immediately", async () => {
  const { window, provider, chrome } = loadProvider();
  try {
    withOrgLabel(window, "Manikandan B · Zohocorp");
    const team = provider.orgKey();
    withOrgLabel(window, "Manikandan B · Zoho India");
    const ent = provider.orgKey();

    // both orgs have been seen before, so both sit in the archive
    chrome.__store["cus:models"] = {
      [team]: { org: team, plan: "team", session: { type: "session", pct: 7 }, updatedAt: Date.now() },
      [ent]: { org: ent, plan: "enterprise", session: { type: "spend", pct: 65 }, updatedAt: Date.now() },
    };
    chrome.__store["cus:model"] = chrome.__store["cus:models"][ent];

    assert.equal((await provider.fetchUsage()).plan, "enterprise", "current org from the latest slot");

    withOrgLabel(window, "Manikandan B · Zohocorp");
    const back = await provider.fetchUsage();
    assert.ok(back, "switching back must not blank out");
    assert.equal(back.plan, "team", "and must serve that org's own numbers");
  } finally {
    window.close();
  }
});

test("a model with no org attached is still served (unknown identity)", async () => {
  const { window, provider, chrome } = loadProvider();
  try {
    chrome.__store["cus:model"] = { plan: "pro", session: { type: "session", pct: 5 }, updatedAt: Date.now() };
    const m = await provider.fetchUsage();
    assert.ok(m, "an unidentifiable org must not blank the UI");
    assert.equal(m.plan, "pro");
  } finally {
    window.close();
  }
});

/* ---------------------------------------------------------------------------
 * The composer must never be disturbed. A previous build snapshotted the caret
 * before a refresh and restored it on a timer, which dragged the caret
 * backwards mid-sentence and swallowed keystrokes. The rule now: no focus or
 * selection manipulation anywhere in the shipped code, and the refresh frame is
 * inert so it cannot take focus either.
 * ------------------------------------------------------------------------- */

const fsp = require("node:fs");
const pathp = require("node:path");
const SRC_ROOT = pathp.join(__dirname, "..");

test("shipped code never moves focus or the selection", () => {
  const banned = [
    [/\.focus\s*\(/, "focus() call"],
    [/removeAllRanges\s*\(/, "Selection.removeAllRanges()"],
    [/\baddRange\s*\(/, "Selection.addRange()"],
    [/setSelectionRange\s*\(/, "setSelectionRange()"],
    [/\.blur\s*\(/, "blur() call"],
  ];
  for (const file of ["content.js", "usage-provider.js"]) {
    const src = fsp.readFileSync(pathp.join(SRC_ROOT, file), "utf8");
    // strip comments so prose describing the old bug does not trip the check
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [re, label] of banned) {
      assert.ok(!re.test(code), `${file} must not contain a ${label} — it fights the person typing`);
    }
  }
});

test("the refresh frame uses display:none, the only mitigation that works", () => {
  // Measured in Chrome: offscreen+opacity, inert, sandbox and visibility:hidden
  // all still let the framed page take focus. display:none does not, because a
  // frame with no layout box cannot be focused.
  const src = fsp.readFileSync(pathp.join(SRC_ROOT, "usage-provider.js"), "utf8");
  assert.match(src, /if \(noLayout\) f\.style\.display = "none";/,
    "the focus-safe frame must be display:none");
  assert.match(src, /setAttribute\("tabindex", "-1"\)/, "and kept out of the tab order");
  // a rendered frame may only be used when the user is not in the tab
  assert.match(src, /function userIsAway\(\)/, "there must be an away check");
  assert.match(src, /document\.hidden \|\| !document\.hasFocus\(\)/,
    "away must mean hidden OR unfocused, so another app counts too");
  // the focus-safe frame must be attempted before any rendered one
  const body = src.slice(src.indexOf("async function pullUsage"));
  const firstSafe = body.indexOf("attemptPull(true");
  const firstRendered = body.indexOf("attemptPull(false");
  assert.ok(firstSafe > -1 && firstSafe < firstRendered,
    "the focus-safe frame must always be tried first");
  // and a rendered frame must be unreachable while the user is present
  assert.match(src, /if \(!userIsAway\(\)\) return null;/,
    "a rendered frame must be gated on the user being away");
});

test("a rendered frame is abandoned if typing starts mid-pull", () => {
  const src = fsp.readFileSync(pathp.join(SRC_ROOT, "usage-provider.js"), "utf8");
  assert.match(src, /if \(!noLayout && isUserTyping\(\)\) return null;/,
    "a rendered frame must bail out the moment the user starts typing");
});

test("a refresh is skipped while the user is actively typing", async () => {
  const { window, provider } = loadProvider();
  try {
    const input = window.document.createElement("textarea");
    window.document.body.appendChild(input);
    input.focus();
    // simulate a keystroke landing in the composer right now
    window.document.dispatchEvent(new window.Event("keydown", { bubbles: true }));
    assert.equal(provider.isUserTyping(), true, "a fresh keystroke in an editable means typing");

    const before = window.document.querySelectorAll("iframe").length;
    await provider.pullUsage({ minGapMs: 0 });
    assert.equal(
      window.document.querySelectorAll("iframe").length, before,
      "no refresh frame may be created while typing"
    );
  } finally {
    window.close();
  }
});

test("typing state lapses once the keystrokes stop", () => {
  const { window, provider } = loadProvider();
  try {
    const input = window.document.createElement("input");
    window.document.body.appendChild(input);
    input.focus();
    assert.equal(provider.isUserTyping(), false, "no recent keystroke: not typing");
  } finally {
    window.close();
  }
});
