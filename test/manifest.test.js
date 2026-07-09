"use strict";

// Packaging sanity: the manifest must be valid MV3 and every asset it points at
// must actually exist (this is what a broken icon path / renamed file trips on).

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")
);

test("manifest.json is valid MV3 with required fields", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.name, "name is required");
  assert.ok(manifest.version, "version is required");
  assert.ok(
    Array.isArray(manifest.content_scripts) && manifest.content_scripts.length,
    "content_scripts must be a non-empty array"
  );
  assert.ok(
    manifest.content_scripts[0].matches.some((m) => /claude\.ai/.test(m)),
    "content script must match claude.ai"
  );
});

test("every file referenced by the manifest exists on disk", () => {
  const refs = [];
  (function walk(o) {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
    else if (typeof o === "string" && /\.(js|css|png|svg|html)$/.test(o))
      refs.push(o);
  })(manifest);

  assert.ok(refs.length > 0, "expected some referenced assets");
  for (const r of refs) {
    assert.ok(
      fs.existsSync(path.join(ROOT, r)),
      `manifest references missing file: ${r}`
    );
  }
});

test("content-script files exist and are non-empty", () => {
  for (const f of ["usage-provider.js", "content.js", "styles.css"]) {
    const p = path.join(ROOT, f);
    assert.ok(fs.existsSync(p), `${f} is missing`);
    assert.ok(fs.statSync(p).size > 0, `${f} is empty`);
  }
});
