# dist

The packaged extension, ready to upload to the Chrome Web Store or to load
unpacked after unzipping. Built from the repo root with runtime files only:

    manifest.json  content.js  usage-provider.js  styles.css  icons/*.png

Tests, CI config, screenshots and docs are deliberately left out — they are not
loaded at runtime and only pad the review package.

The zip's version must match `manifest.json` at the repo root. The store
rejects an upload whose version is not higher than the published one.
