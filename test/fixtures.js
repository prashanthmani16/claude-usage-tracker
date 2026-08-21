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

module.exports = {
  bar,
  proMaxDialog,
  enterpriseDialog,
  teamDialog,
  sidebarShell,
  legacySidebarShell,
};
