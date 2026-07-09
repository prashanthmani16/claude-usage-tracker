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

module.exports = { bar, proMaxDialog, enterpriseDialog };
