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
