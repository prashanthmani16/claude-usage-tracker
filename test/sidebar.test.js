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
    // Width is not pinned in px: the strip mirrors the composer's horizontal
    // margins and lets the shared parent drive the width, so the two stay equal
    // through any reflow. (Verified for real in a browser; jsdom has no layout.)
    assert.equal(strip.style.width, "auto", "width must follow the parent, not a measurement");
    const composer = ext.window.document.querySelector("form");
    const ccs = ext.window.getComputedStyle(composer);
    assert.equal(strip.style.marginLeft, ccs.marginLeft, "left margin mirrors the composer");
    assert.equal(strip.style.marginRight, ccs.marginRight, "right margin mirrors the composer");
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

test("Claude Design falls back to the session when the plan has no allowance", async () => {
  // Team has no Claude Design allowance, so the design surface shows the
  // session meter rather than nothing.
  const { designComposerShell } = require("./fixtures");
  const ext = await loadExtension({
    html: designComposerShell(),
    model: { session: SPEND, design: null },
    path: "/design/p/abc123",
  });
  try {
    const strip = ext.strip();
    assert.ok(strip, "expected a strip on the design surface");
    assert.match(strip.textContent, /Spend \$80\.65 \/ \$125\.00/);
    assert.match(strip.textContent, /65% used/, "a session/spend meter reads '% used'");
  } finally {
    await ext.close();
  }
});

test("Claude Design shows its own allowance when the plan has one", async () => {
  const { designComposerShell } = require("./fixtures");
  const ext = await loadExtension({
    html: designComposerShell(),
    model: { session: SPEND, design: DESIGN },
    path: "/design/p/abc123",
  });
  try {
    const strip = ext.strip();
    assert.match(strip.textContent, /Claude Design/);
    assert.match(strip.textContent, /99%/);
    assert.ok(!/% used/.test(strip.textContent), "the allowance reads as a bare %");
  } finally {
    await ext.close();
  }
});

test("Claude Design never gets the card, even though it has its own <nav>", async () => {
  // The design app ships <nav class="om-ds-outline-aside"> for its component
  // outline. Accepting a bare <nav> put the card inside that list.
  const { designComposerShell } = require("./fixtures");
  const ext = await loadExtension({
    html: '<nav class="om-ds-outline-aside"><a>Accordion</a><a>Button</a></nav>' + designComposerShell(),
    model: { session: SPEND, sidebar: WEEKLY, design: DESIGN },
    path: "/design/p/abc123",
  });
  try {
    assert.ok(ext.strip(), "the strip is still expected here");
    assert.equal(ext.card(), null, "but never the card");
    assert.equal(
      ext.window.document.querySelector("nav").querySelector('[data-cus="sidebar"]'),
      null,
      "and nothing of ours inside the design app's own nav"
    );
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

test("the clip keeps a band as tall as the composer's corner radius", async () => {
  // Clipping flush to the composer's bottom edge removed the fill that covers
  // the notches left by its rounded corners, and the outline visibly broke at
  // the join. The clip must stop short by exactly the radius.
  const ext = await loadExtension({
    html: composerShell(672, 120, 20),
    model: { session: SPEND },
  });
  try {
    const clip = ext.strip().style.clipPath;
    const inset = Number(/inset\((\d+)px/.exec(clip)?.[1]);
    // composer bottom is at 120 in the stubbed layout, strip top at 0
    assert.equal(inset, 100, `expected 120 - 20 = 100, got ${clip}`);
  } finally {
    await ext.close();
  }
});

test("styles.css squares the strip's top corners", () => {
  const css = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "styles.css"), "utf8"
  );
  const rule = /\.cus-stats-layer \{[\s\S]*?\}/.exec(css)[0];
  const radius = /border-radius:\s*([^;]+);/.exec(rule)[1].trim();
  assert.equal(
    radius, "0 0 20px 20px",
    "rounded top corners pinch against the composer's rounded bottom corners"
  );
});

test("in a conversation, the strip clears the opaque disclaimer bar", async () => {
  // The bar is an opaque later sibling in the same stacking layer as the
  // composer's wrapper, so it buried the strip — visible on the home screen,
  // invisible in a chat. The wrapper has to be lifted out of that layer.
  const { chatFooterShell } = require("./fixtures");
  const ext = await loadExtension({
    html: chatFooterShell(),
    model: { session: SPEND },
    path: "/chat/abc123",
  });
  try {
    const strip = ext.strip();
    assert.ok(strip, "expected the strip in a conversation");
    const group = strip.parentElement;
    assert.match("" + group.className, /composer-group/, "strip lives in the composer's wrapper");
    assert.equal(group.style.zIndex, "1", "the wrapper must be lifted above the disclaimer bar");
  } finally {
    await ext.close();
  }
});

test("an existing z-index on the composer's wrapper is left alone", async () => {
  const { chatFooterShell } = require("./fixtures");
  const html = chatFooterShell().replace(
    'class="composer-group" style="position:relative"',
    'class="composer-group" style="position:relative;z-index:4"'
  );
  const ext = await loadExtension({ html, model: { session: SPEND }, path: "/chat/abc" });
  try {
    assert.equal(
      ext.strip().parentElement.style.zIndex, "4",
      "must not stomp a z-index the page set itself"
    );
  } finally {
    await ext.close();
  }
});

/* ---------------------------------------------------------------------------
 * Narrow composers. The Claude Design chat panel is drag-resizable, and the
 * fixed content (label 89px, "N% used" 57px, divider, timer 57px, gaps,
 * padding) needs 280px on its own — so at that panel's ~304px the bar was left
 * about 24px, and below 280px the strip did not render at all.
 * ------------------------------------------------------------------------- */

const tierOf = (strip) =>
  strip.classList.contains("cus-w-xs") ? "xs"
  : strip.classList.contains("cus-w-sm") ? "sm"
  : "full";

test("a narrow composer still gets a strip", async () => {
  const ext = await loadExtension({ html: composerShell(200, 100), model: { session: SPEND } });
  try {
    assert.ok(ext.strip(), "200px wide must still render — 280 suppressed it entirely");
  } finally {
    await ext.close();
  }
});

test("width tiers shed the label, then the timer, then shorten the percentage", async () => {
  const cases = [
    { w: 400, tier: "full", pct: /% used$/ },
    { w: 300, tier: "sm", pct: /% used$/ },   // label dropped
    { w: 200, tier: "xs", pct: /% used$/ },   // timer dropped too
    { w: 130, tier: "xs", pct: /^\d+%$/ },    // percentage shortened
  ];
  for (const c of cases) {
    const ext = await loadExtension({ html: composerShell(c.w, 100), model: { session: SPEND } });
    try {
      const strip = ext.strip();
      assert.equal(tierOf(strip), c.tier, `${c.w}px should be tier ${c.tier}`);
      assert.match(strip.querySelector(".cus-strip-pct").textContent, c.pct, `${c.w}px percentage`);
    } finally {
      await ext.close();
    }
  }
});

test("the splash stub is still rejected after lowering the minimum", async () => {
  const ext = await loadExtension({ html: composerShell(48, 210), model: { session: SPEND } });
  try {
    assert.equal(ext.strip(), null, "a few-px pre-boot stub must never get a strip");
  } finally {
    await ext.close();
  }
});

test("the composer is watched for resize, so panel drags re-align it", async () => {
  const ext = await loadExtension({ html: composerShell(400, 100), model: { session: SPEND } });
  try {
    assert.equal(tierOf(ext.strip()), "full");
    // simulate a panel drag: shrink the composer, then let a repaint land
    const form = ext.window.document.querySelector("form");
    form.setAttribute("data-rect", "200,100");
    ext.window.document.body.appendChild(ext.window.document.createElement("span")); // nudge the observer
    await ext.settle();
    assert.equal(tierOf(ext.strip()), "xs", "the strip must re-tier when the composer narrows");
    assert.equal(ext.strip().style.width, "auto", "width still follows the parent, never pinned");
  } finally {
    await ext.close();
  }
});
