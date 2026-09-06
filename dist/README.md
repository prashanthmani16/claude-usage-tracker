# dist

The packaged extension, ready to upload to the Chrome Web Store or to load
unpacked after unzipping. Built from the repo root with runtime files only:

    manifest.json  content.js  usage-provider.js  styles.css  icons/*.png

Tests, CI config, screenshots and docs are deliberately left out — they are not
loaded at runtime and only pad the review package. `dist/` itself is excluded
too, so a package never nests a copy of itself.

The zip's version must match `manifest.json` at the repo root. Each store
rejects an upload whose version is not higher than the one already published.

## Firefox

This zip is the CHROME package. Firefox needs one extra manifest key that is
deliberately not committed, because Chrome has no use for it:

```json
"browser_specific_settings": {
  "gecko": {
    "id": "claude-usage-stats@prashanthmani16.github.io",
    "strict_min_version": "140.0",
    "data_collection_permissions": { "required": ["none"] }
  },
  "gecko_android": { "strict_min_version": "142.0" }
}
```

AMO requires an explicit add-on ID for MV3, and `data_collection_permissions`
for anything submitted since November 2025. `140`/`142` are the Firefox versions
that introduced that key. Keep the ID stable — AMO ties updates to it.
