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

const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, "..", "content.js"),
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
          // the real API accepts a string, an array of keys, or an object of
          // key->default; the provider reads several keys at once
          const o = {};
          const keys = Array.isArray(key) ? key : key == null ? Object.keys(store)
                     : typeof key === "object" ? Object.keys(key) : [key];
          for (const k of keys) if (store[k] !== undefined) o[k] = store[k];
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

// Boot the FULL extension (provider + content script) over a sidebar shell, with
// the storage cache pre-seeded so content.js paints on its first tick without
// scraping anything.
//
// Two jsdom gaps matter here:
//   - there is no layout, so getBoundingClientRect() is all zeros; the collapse
//     gate measures the sidebar root, so we give that element a real width.
//   - `updatedAt` is stamped fresh so the provider's background loop treats the
//     cache as current and never opens its hidden refresh iframe.
async function loadExtension(opts) {
  opts = opts || {};
  const width = opts.sidebarWidth == null ? 288 : opts.sidebarWidth;
  const model = Object.assign(
    { plan: "team", sidebar: [], session: null, design: null },
    opts.model,
    { updatedAt: Date.now() }
  );

  const dom = new JSDOM(
    `<!doctype html><html><body>${opts.html || ""}</body></html>`,
    { url: "https://claude.ai" + (opts.path || "/new"), runScripts: "outside-only" }
  );
  const { window } = dom;

  // content.js coalesces repaints through requestAnimationFrame. jsdom only
  // supplies rAF under `pretendToBeVisual`, whose frame loop keeps firing after
  // window.close() and then throws against the torn-down window — so shim rAF
  // onto the window's OWN timers instead, which close() does clear.
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);

  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent;
    },
  });

  window.chrome = stubChrome({ "cus:model": model });

  // jsdom has no layout engine, so every getBoundingClientRect() is zeros --
  // which the composer's usability check reads as "unusable". Let fixtures
  // declare their own box via data-rect="<width>,<height>".
  window.Element.prototype.getBoundingClientRect = function () {
    const spec = this.getAttribute && this.getAttribute("data-rect");
    let w = 0, h = 0;
    if (spec) {
      const parts = spec.split(",");
      w = Number(parts[0]) || 0;
      h = Number(parts[1]) || 0;
    }
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 };
  };

  const root =
    window.document.querySelector("aside.dframe-sidebar") ||
    window.document.querySelector("nav");
  if (root) {
    root.getBoundingClientRect = () => ({
      width, height: 900, top: 0, left: 0, right: width, bottom: 900, x: 0, y: 0,
    });
  }

  const ctx = dom.getInternalVMContext();
  vm.runInContext(PROVIDER_SRC, ctx, { filename: "usage-provider.js" });
  vm.runInContext(CONTENT_SRC, ctx, { filename: "content.js" });

  // content.js start() is async (await fetchUsage -> paint); let it settle.
  await new Promise((r) => setTimeout(r, 30));

  return {
    window,
    dom,
    card: () => window.document.querySelector('[data-cus="sidebar"]'),
    strip: () => window.document.querySelector('[data-cus="composer"]'),
    designStrip: () => window.document.querySelector('[data-cus="design"]'),
    // let a mutation-driven repaint land, then read the DOM again
    settle: () => new Promise((r) => setTimeout(r, 40)),
    // content.js installs intervals, a MutationObserver and rAF repaints; let
    // any queued repaint drain BEFORE tearing the window down, otherwise a
    // callback fires against a closed window and throws. Closing stops the
    // remaining timers so the test process can exit.
    close: async () => {
      await new Promise((r) => setTimeout(r, 60));
      window.close();
      await new Promise((r) => setTimeout(r, 10));
    },
  };
}

module.exports = { loadProvider, makeDialog, stubChrome, loadExtension };
