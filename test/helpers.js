"use strict";

// Test harness: load the real `usage-provider.js` IIFE inside a jsdom window
// (with a stubbed `chrome` and an `innerText` polyfill), then hand back the
// public `window.ClaudeUsageProvider` API for assertions.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const PROVIDER_SRC = fs.readFileSync(
  path.join(__dirname, "..", "usage-provider.js"),
  "utf8"
);

// Minimal chrome.storage.local + onChanged stub backed by a plain object.
function stubChrome(store) {
  store = store || {};
  const listeners = [];
  return {
    storage: {
      local: {
        get(key, cb) {
          const o = {};
          if (store[key] !== undefined) o[key] = store[key];
          cb(o);
        },
        set(obj, cb) {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: store[k], newValue: obj[k] };
            store[k] = obj[k];
          }
          listeners.forEach((l) => l(changes, "local"));
          if (cb) cb();
        },
      },
      onChanged: {
        addListener(fn) {
          listeners.push(fn);
        },
      },
    },
    __store: store,
  };
}

function loadProvider() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://claude.ai/new",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom does not implement innerText; usageDialogIn() and detectPlanFromDOM()
  // read it. Alias it to textContent so those code paths work under test.
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent;
    },
  });

  window.chrome = stubChrome();

  const ctx = dom.getInternalVMContext();
  vm.runInContext(PROVIDER_SRC, ctx, { filename: "usage-provider.js" });

  return {
    window,
    dom,
    chrome: window.chrome,
    provider: window.ClaudeUsageProvider,
  };
}

// Build a `[role="dialog"]` element from an HTML string of rows and attach it
// to the jsdom body (so scrapeUsage()/usageDialogIn() can find it too).
function makeDialog(window, innerHTML) {
  const dlg = window.document.createElement("div");
  dlg.setAttribute("role", "dialog");
  dlg.innerHTML = innerHTML;
  window.document.body.appendChild(dlg);
  return dlg;
}

module.exports = { loadProvider, makeDialog, stubChrome };
