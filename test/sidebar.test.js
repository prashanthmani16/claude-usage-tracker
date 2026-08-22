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

test("injects the card as the tray's first child in the CURRENT sidebar shell", async () => {
  const ext = await loadExtension({ html: sidebarShell(), model: { sidebar: WEEKLY } });
  try {
    const card = ext.card();
    assert.ok(card, "expected a [data-cus=sidebar] card to be injected");

    // INSIDE the tray, immediately above the products row. The divider above
    // Design is the tray's own ::before at its top edge, so a card inside the
    // tray falls below that divider: divider / card / Design / divider / profile.
    const tray = ext.window.document.querySelector(".df-bottom-tray");
    const design = ext.window.document.querySelector(".df-products-block");
    assert.equal(card.parentElement, tray, "card must be a child of .df-bottom-tray");
    assert.equal(card.nextElementSibling, design, "card must sit directly above the products row");
    assert.equal(tray.firstElementChild, card, "card must be the tray's first child");
    // Still above Design in document order, which was the original requirement.
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

test("the reset row's stopwatch is a real SVG element, not markup", async () => {
  const ext = await loadExtension({
    html: sidebarShell(),
    model: { sidebar: WEEKLY },
  });
  try {
    const reset = ext.card().querySelector(".cus-reset");
    const svg = reset.querySelector("svg");
    assert.ok(svg, "the stopwatch must be present");
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg", "must be in the SVG namespace");
    assert.ok(svg.querySelector("path"), "the glyph path must be there");
    // the label must still be the reset row's only <span> child
    assert.equal(reset.querySelectorAll(":scope > span").length, 1);
  } finally {
    await ext.close();
  }
});

/* ---------------------------------------------------------------------------
 * Regressions from claude.ai's composer redesign (Aug 2026):
 *   - the composer is now wrapped in an `isolation: isolate` container, which
 *     forms a stacking context and trapped the strip's z-index:-1 beneath the
 *     in-context backgrounds -- painted, but invisible.
 *   - the Claude Design surface has NO side nav, so the card's last-resort
 *     anchor fell through to <body> and stretched full-page width.
 *   - that surface also showed nothing at all when the plan has no design
 *     allowance, because the design branch only ever rendered data.design.
 * ------------------------------------------------------------------------- */

const DESIGN = { name: "Claude Design", pct: 99, reset: "Expires July 18" };

test("the strip clips its tucked top instead of hiding behind z-index", async () => {
  const ext = await loadExtension({ html: composerShell(672), model: { session: SPEND } });
  try {
    const strip = ext.strip();
    // must not opt back into the negative stacking layer
    assert.notEqual(strip.style.zIndex, "-1");
    // the part overlapping the composer is clipped away instead
    assert.match(
      strip.style.clipPath,
      /^inset\(\d+px 0 0 0\)$/,
      `expected an inset clip, got ${JSON.stringify(strip.style.clipPath)}`
    );
  } finally {
    await ext.close();
  }
});

test("styles.css does not put the strip behind a negative z-index", () => {
  const css = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "styles.css"), "utf8"
  );
  // strip comments first -- the explanation of this very fix mentions z-index:-1
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = declarations.split("\n").filter((l) => /z-index\s*:\s*-\d/.test(l));
  assert.deepEqual(bad, [], "a negative z-index is invisible inside an isolated composer");
});

test("design surface falls back to the session strip when there is no allowance", async () => {
  const ext = await loadExtension({
    html: composerShell(800, 140),
    model: { session: SPEND, design: null },
    path: "/design",
  });
  try {
    const layer = ext.designStrip();
    assert.ok(layer, "the design surface must still show something");
    assert.match(layer.textContent, /Spend \$80\.65 \/ \$125\.00/);
    assert.match(layer.textContent, /65% used/, "a session/spend meter reads '% used'");
  } finally {
    await ext.close();
  }
});

test("design surface prefers the design allowance when the plan has one", async () => {
  const ext = await loadExtension({
    html: composerShell(800, 140),
    model: { session: SPEND, design: DESIGN },
    path: "/design",
  });
  try {
    const layer = ext.designStrip();
    assert.match(layer.textContent, /Claude Design/);
    assert.match(layer.textContent, /99%/);
    assert.ok(!/% used/.test(layer.textContent), "the design allowance shows a bare %");
  } finally {
    await ext.close();
  }
});

test("no card is injected on a surface with no side nav", async () => {
  // Claude Design renders no side nav at all; the card used to land in <body>.
  const ext = await loadExtension({
    html: composerShell(800, 140),
    model: { sidebar: WEEKLY, session: SPEND },
    path: "/design",
  });
  try {
    assert.equal(ext.card(), null, "no side nav -> no card anywhere");
    const stray = ext.window.document.body.querySelector(':scope > [data-cus="sidebar"]');
    assert.equal(stray, null, "and certainly not appended to <body>");
  } finally {
    await ext.close();
  }
});

test("design strip tucks under the OUTER tray card, not the inner input box", async () => {
  const { designComposerShell } = require("./fixtures");
  const ext = await loadExtension({
    html: designComposerShell(),
    model: { session: SPEND, design: DESIGN },
    path: "/design",
  });
  try {
    const layer = ext.designStrip();
    assert.ok(layer, "expected the design strip");
    const anchor = layer.previousElementSibling;
    assert.match(
      "" + anchor.className,
      /om-tray-unit/,
      `strip must follow the outer tray card, but followed ${anchor.className}`
    );
    assert.equal(layer.style.width, "800px", "and match the tray's width");
  } finally {
    await ext.close();
  }
});

test("with no products row, the card still goes inside the tray", async () => {
  // Accounts without those products have no .df-products-block. The card must
  // stay INSIDE the tray (above the profile row) so the tray's divider is still
  // drawn above it rather than between it and the profile.
  const shell = sidebarShell().replace(
    '<div class="df-products-block"><a>Design</a></div>',
    ""
  );
  const ext = await loadExtension({ html: shell, model: { sidebar: WEEKLY } });
  try {
    const card = ext.card();
    const tray = ext.window.document.querySelector(".df-bottom-tray");
    const footer = ext.window.document.querySelector(".df-footer-row");
    assert.ok(card, "expected a card");
    assert.equal(card.parentElement, tray, "card must still be inside the tray");
    assert.equal(card.nextElementSibling, footer, "and sit directly above the profile row");
  } finally {
    await ext.close();
  }
});
