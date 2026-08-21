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
