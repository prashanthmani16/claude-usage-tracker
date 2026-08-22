"use strict";

// Fixtures that mirror the real Settings → Usage DOM. `role` is parameterised so
// the same shape can be emitted as the CURRENT layout (role="meter") or the
// LEGACY layout (role="progressbar") — the parser must handle both.

function bar(role, value) {
  return value == null
    ? `<div role="${role}"></div>`
    : `<div role="${role}" aria-valuenow="${value}"></div>`;
}

// Pro / Max: a "Current session" plan bar + a "Weekly limits" section of bars.
// Order matches the live DOM: label, reset, "N% used" text, then the bar.
function proMaxDialog(role) {
  role = role || "meter";
  return [
    "<h2>Plan usage limits</h2>",
    "<span>Max</span>",
    "<span>Current session</span>",
    "<span>Resets in 3 hr 19 min</span>",
    "<span>16% used</span>",
    bar(role, 16),
    "<h2>Weekly limits</h2>",
    "<span>All models</span>",
    "<span>Resets in 18 hr 9 min</span>",
    "<span>26% used</span>",
    bar(role, 26),
    "<span>Fable</span>",
    "<span>Resets in 18 hr 9 min</span>",
    "<span>38% used</span>",
    bar(role, 38),
  ].join("");
}

// Enterprise: a spend meter ("$X of $Y spent") under "Your usage limits", and
// no weekly section (so the sidebar card stays empty by design).
function enterpriseDialog(role) {
  role = role || "meter";
  return [
    "<h2>Your usage limits</h2>",
    "<span>Enterprise</span>",
    "<span>$19.80 of $125.00 spent</span>",
    "<span>Resets Sat, Aug 1</span>",
    "<span>16% used</span>",
    bar(role, 16),
  ].join("");
}


// Team plan, captured VERBATIM from the live claude.ai Settings → Usage dialog
// (Aug 2026): heading is "Your usage limits" (not "Plan usage limits"), the
// weekly section carries a promo blurb, and the unused-model line uses a CURLY
// apostrophe ("haven’t") — which previously defeated the reset matcher and
// leaked the whole sentence into the meter's NAME.
function teamDialog(role) {
  role = role || "meter";
  return [
    "<h2>Your usage limits</h2>",
    "<span>Team</span>",
    "<span>Current session</span>",
    "<span>Resets in 4 hr 31 min</span>",
    "<span>7% used</span>",
    bar(role, 7),
    "<h2>Weekly limits</h2>",
    "<span>Your limits are temporarily boosted.</span>",
    "<span>Your weekly Claude Code limit is 50% higher through August 31.</span>",
    "<span>Learn more about usage limits</span>",
    "<span>All models</span>",
    "<span>Resets Sat 7:29 PM</span>",
    "<span>1% used</span>",
    bar(role, 1),
    "<span>Fable</span>",
    "<span>You haven’t used Fable yet</span>",
    "<span>0% used</span>",
    bar(role, 0),
    "<span>Last updated: just now</span>",
  ].join("");
}

// The CURRENT claude.ai side-nav shell (Aug 2026). There is no <nav> element and
// no [data-testid="menu-sidebar"]; the shell is an <aside class="dframe-sidebar">
// wrapping a [data-testid="sidebar"] body whose last child is a bottom tray
// ending in .df-footer-row (the avatar + "<name> · <org>" profile row).
function sidebarShell() {
  return [
    '<aside class="dframe-sidebar">',
    '  <div class="cds-reset group/resize"></div>',
    '  <div class="df-titlebar draggable h-11 shrink-0"></div>',
    '  <div data-testid="sidebar" class="dframe-sidebar-body flex flex-col flex-1">',
    '    <div class="df-pills"><a aria-label="Home">Home</a><a aria-label="Code">Code</a></div>',
    '    <div class="dframe-nav-scroll flex flex-col flex-1"><a>Projects</a><a>Artifacts</a></div>',
    '    <div class="df-banner-slot"></div>',
    '    <div class="df-bottom-tray shrink-0">',
    '      <div class="df-products-block"><a>Design</a></div>',
    '      <div class="df-footer-row shrink-0 flex items-center">',
    '        <button aria-label="Settings">AB</button><span>Ada B \u00b7 Acme</span>',
    "      </div>",
    "    </div>",
    "  </div>",
    "</aside>",
  ].join("");
}

// The LEGACY shell the finders were originally written against: a real <nav>
// whose profile button is labelled "<name>, Settings", inside a border-t row.
function legacySidebarShell() {
  return [
    '<nav data-testid="menu-sidebar">',
    "  <div><a>Chats</a></div>",
    '  <div class="border-t border-border-300">',
    '    <button aria-label="Ada B, Settings">Ada B Pro plan</button>',
    "  </div>",
    "</nav>",
  ].join("");
}


// A chat surface with a composer. `width` drives the fake layout box: the real
// composer measures ~672px, while the pre-boot splash renders a stub only a few
// px wide (which used to collapse the strip into a tall pill).
function composerShell(width, height, radius) {
  width = width == null ? 672 : width;
  height = height == null ? 120 : height;
  // claude.ai's composer has 20px rounded bottom corners; the strip has to stay
  // visible across that band to fill the notches they leave.
  var style = radius == null ? "" : ' style="border-bottom-left-radius:' + radius + 'px"';
  return [
    "<main>",
    '  <form data-rect="' + width + "," + height + '"' + style + ">",
    '    <div contenteditable="true"></div>',
    "  </form>",
    "</main>",
  ].join("");
}


// Free: a session bar and NO "Weekly limits" section, so there is no sidebar
// card and only the composer strip. MODELLED on the Pro/Max layout (the panel
// is the same component) rather than captured from a live Free account.
function freeDialog(role) {
  role = role || "meter";
  return [
    "<h2>Plan usage limits</h2>",
    "<span>Free</span>",
    "<span>Current session</span>",
    "<span>Resets in 2 hr 5 min</span>",
    "<span>48% used</span>",
    bar(role, 48),
  ].join("");
}

// Pro: session bar + a single weekly "All models" bar (Pro has no per-model
// weekly split, so the card carries exactly one meter).
function proDialog(role) {
  role = role || "meter";
  return [
    "<h2>Plan usage limits</h2>",
    "<span>Pro</span>",
    "<span>Current session</span>",
    "<span>Resets in 1 hr 12 min</span>",
    "<span>22% used</span>",
    bar(role, 22),
    "<h2>Weekly limits</h2>",
    "<span>All models</span>",
    "<span>Resets Sat 7:29 PM</span>",
    "<span>55% used</span>",
    bar(role, 55),
  ].join("");
}

// Max: the badge carries the tier multiplier ("Max (20x)"), which must NOT be
// picked up as a meter name, and the weekly section lists two models.
function maxTierDialog(role) {
  role = role || "meter";
  return [
    "<h2>Plan usage limits</h2>",
    "<span>Max (20x)</span>",
    "<span>Current session</span>",
    "<span>Resets in 3 hr 19 min</span>",
    "<span>16% used</span>",
    bar(role, 16),
    "<h2>Weekly limits</h2>",
    "<span>All models</span>",
    "<span>Resets in 18 hr 9 min</span>",
    "<span>26% used</span>",
    bar(role, 26),
    "<span>Fable</span>",
    "<span>Resets in 18 hr 9 min</span>",
    "<span>38% used</span>",
    bar(role, 38),
  ].join("");
}

// Enterprise, FULL layout: the spend meter, plus the "Claude Code and Cowork
// credit" section, plus the separate "Claude Design" allowance. The credit
// section is parsed but deliberately not surfaced; Design is shown on the
// design surface only.
function enterpriseFullDialog(role) {
  role = role || "meter";
  return [
    "<h2>Your usage limits</h2>",
    "<span>Enterprise</span>",
    "<span>$80.65 of $125.00 spent</span>",
    "<span>Resets Sat, Aug 1</span>",
    "<span>65% used</span>",
    bar(role, 65),
    "<h2>Claude Code and Cowork credit</h2>",
    "<span>Monthly spend</span>",
    "<span>$12.00 of $50.00 spent</span>",
    "<span>24% used</span>",
    bar(role, 24),
    "<h2>Claude Design</h2>",
    "<span>Expires July 18</span>",
    "<span>99% used</span>",
    bar(role, 99),
  ].join("");
}


// The Claude Design composer: an inner input box (bordered, rounded) nested in a
// larger rounded tray card, with the template picker between them. Mirrors the
// live structure, where the tray is `.om-tray-unit`.
function designComposerShell() {
  return [
    '<div class="om-tray-unit" style="border-top-left-radius:17px" data-rect="800,440">',
    '  <div class="inner-input" style="border-top-left-radius:16px;border-top-width:1px" data-rect="800,140">',
    '    <div contenteditable="true"></div>',
    "  </div>",
    '  <div class="template-panel" data-rect="800,290"></div>',
    "</div>",
  ].join("");
}

module.exports = {
  bar,
  composerShell,
  designComposerShell,
  freeDialog,
  proDialog,
  maxTierDialog,
  enterpriseFullDialog,
  proMaxDialog,
  enterpriseDialog,
  teamDialog,
  sidebarShell,
  legacySidebarShell,
};
