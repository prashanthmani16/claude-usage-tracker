"use strict";

// Regression tests for the side-nav card injection.
//
// The card silently vanished on every plan when claude.ai reshaped its shell:
// the <nav> element disappeared (so the finders fell back to document.body) and
// the profile button's aria-label changed from "<name>, Settings" to plain
// "Settings". findSidebarFooter() then returned null and injectSidebar() bailed
// before building anything. These tests pin the current shell, the legacy
// fallback, and the collapse gate.

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadExtension } = require("./helpers");
const { sidebarShell, legacySidebarShell } = require("./fixtures");

const WEEKLY = [
  { name: "All models", pct: 1, reset: "Resets Sat 7:29 PM" },
  { name: "Fable", pct: 0, reset: "You haven’t used Fable yet" },
];

test("injects the card above the bottom tray in the CURRENT sidebar shell", async () => {
  const ext = await loadExtension({ html: sidebarShell(), model: { sidebar: WEEKLY } });
  try {
    const card = ext.card();
    assert.ok(card, "expected a [data-cus=sidebar] card to be injected");

    // Anchored immediately above the whole bottom tray, so it clears BOTH the
    // products row ("Design") and the profile row.
    const tray = ext.window.document.querySelector(".df-bottom-tray");
    assert.equal(card.nextElementSibling, tray, "card must sit directly above .df-bottom-tray");
    assert.equal(
      card.parentElement.getAttribute("data-testid"),
      "sidebar",
      "card must be a direct child of the sidebar body, not inside the tray"
    );
    // Explicitly above Design, which is what makes this placement the intended one.
    const design = ext.window.document.querySelector(".df-products-block");
    assert.ok(
      card.compareDocumentPosition(design) & 4,
      "card must precede the Design products row in document order"
    );

    // Renders one meter per weekly limit, with the model name as the label.
    const names = [...card.querySelectorAll(".cus-meter-name")].map((e) => e.textContent);
    assert.deepEqual(names, ["All models", "Fable"]);
    assert.deepEqual(
      [...card.querySelectorAll(".cus-meter-pct")].map((e) => e.textContent),
      ["1%", "0%"]
    );
  } finally {
    await ext.close();
  }
});

test("an unused model shows its own name, not the 'haven’t used' sentence", async () => {
  const ext = await loadExtension({ html: sidebarShell(), model: { sidebar: WEEKLY } });
  try {
    const card = ext.card();
    const names = [...card.querySelectorAll(".cus-meter-name")].map((e) => e.textContent);
    assert.ok(!names.some((n) => /haven/i.test(n)), "meter name leaked the status sentence: " + names);

    // The curly apostrophe must still collapse to the "not started" label.
    const resets = [...card.querySelectorAll(".cus-reset > span")].map((e) => e.textContent);
    assert.deepEqual(resets, ["Sat 7:29 PM", "Not started yet"]);
  } finally {
    await ext.close();
  }
});

test("still injects into the LEGACY <nav> shell (fallback path)", async () => {
  const ext = await loadExtension({ html: legacySidebarShell(), model: { sidebar: WEEKLY } });
  try {
    assert.ok(ext.card(), "legacy aria-label/border-t fallback should still find an anchor");
  } finally {
    await ext.close();
  }
});

test("hides the card when the sidebar is collapsed to the icon rail", async () => {
  // Collapsed, the live <aside> measures 32px wide.
  const ext = await loadExtension({ html: sidebarShell(), model: { sidebar: WEEKLY }, sidebarWidth: 32 });
  try {
    assert.equal(ext.card(), null, "card must not render in the narrow rail");
  } finally {
    await ext.close();
  }
});

test("renders no card when the plan has no weekly limits (Enterprise)", async () => {
  const ext = await loadExtension({ html: sidebarShell(), model: { plan: "enterprise", sidebar: [] } });
  try {
    assert.equal(ext.card(), null, "empty sidebar data must not produce an empty card");
  } finally {
    await ext.close();
  }
});

test("falls back to the bottom of the sidebar if the tray classes are renamed", async () => {
  // Simulate a future shell where every known profile-row anchor is gone: the
  // card should still land at the bottom of the sidebar rather than vanish.
  const shell = sidebarShell()
    .replace("df-bottom-tray shrink-0", "df-renamed-tray")
    .replace("df-footer-row shrink-0 flex items-center", "df-renamed-row")
    .replace('aria-label="Settings"', 'aria-label="Profile"');
  const ext = await loadExtension({ html: shell, model: { sidebar: WEEKLY } });
  try {
    const card = ext.card();
    assert.ok(card, "expected a fallback anchor, got no card at all");
    assert.ok(
      card.closest('[data-testid="sidebar"]'),
      "fallback card must still live inside the sidebar body"
    );
  } finally {
    await ext.close();
  }
});

/* ---------------------------------------------------------------------------
 * Composer strip: it must not paint onto the initial splash, an auth screen, or
 * a screen the SPA navigated to after the composer unmounted. Reported as
 * "broken stats on the splash screen" — the strip survived as an orphan and
 * alignLayerToComposer() collapsed it into a tall pill with the text outside.
 * ------------------------------------------------------------------------- */

const { composerShell } = require("./fixtures");
const SPEND = {
  type: "spend", currency: "$", spent: 80.65, total: 125, pct: 65,
  reset: "Resets Sat, Aug 1",
};

test("paints the strip on a real chat surface", async () => {
  const ext = await loadExtension({ html: composerShell(672), model: { session: SPEND } });
  try {
    const strip = ext.strip();
    assert.ok(strip, "expected the composer strip on a normal chat page");
    assert.equal(strip.style.width, "672px", "strip should match the composer width");
    assert.match(strip.textContent, /Spend \$80\.65 \/ \$125\.00/);
  } finally {
    await ext.close();
  }
});

test("does NOT paint onto a splash-screen composer stub", async () => {
  // Pre-boot stub: a few px wide. Pinning to this produced the broken pill.
  const ext = await loadExtension({ html: composerShell(48, 210), model: { session: SPEND } });
  try {
    assert.equal(ext.strip(), null, "a stub composer must not get a strip");
  } finally {
    await ext.close();
  }
});

test("paints nothing on an auth / verification screen", async () => {
  const ext = await loadExtension({
    html: composerShell(672) + sidebarShell(),
    model: { session: SPEND, sidebar: WEEKLY },
    path: "/magic-link",
  });
  try {
    assert.equal(ext.strip(), null, "no strip on a verification screen");
    assert.equal(ext.card(), null, "no card on a verification screen");
  } finally {
    await ext.close();
  }
});

test("removes an orphaned strip when the composer unmounts", async () => {
  const ext = await loadExtension({ html: composerShell(672), model: { session: SPEND } });
  try {
    assert.ok(ext.strip(), "strip should be present to begin with");
    // SPA navigates away: the composer goes, the strip must go with it.
    ext.window.document.querySelector("form").remove();
    await ext.settle();
    assert.equal(ext.strip(), null, "strip must not survive its composer");
  } finally {
    await ext.close();
  }
});
