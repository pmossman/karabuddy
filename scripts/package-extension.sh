#!/usr/bin/env bash
# Zip the chrome extension for release / Chrome Web Store submission.
# Output: dist/karabuddy-extension-<version>.zip
#
# manifest.json sits at the zip root (Chrome's requirement), not inside an
# `extension/` subdir. The published manifest strips dev-only host patterns
# (localhost, *.vercel.app) from host_permissions + the karabuddy-bridge.js
# content_scripts.matches list — those exist in the source manifest so the
# bridge can resolve install-token claims against local + preview deploys
# during development, but shipping them to the store would let any Vercel
# preview deploy or anyone MITM'ing localhost request the install token.
#
# Also excluded from the zip:
#   - dotfiles (.DS_Store etc.)
#   - icons/source.html + icons/raw-*.png (icon-design source assets)
#
# Usage:  npm run package:extension
#         (or invoke this script directly from the repo root)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/extension"
DIST_DIR="$REPO_ROOT/dist"

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "error: $EXT_DIR/manifest.json not found" >&2
  exit 1
fi

# Pull version out of manifest.json without depending on jq.
VERSION="$(node -e "console.log(require('$EXT_DIR/manifest.json').version)")"
if [[ -z "$VERSION" || "$VERSION" == "undefined" ]]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
OUT="$DIST_DIR/karabuddy-extension-$VERSION.zip"
rm -f "$OUT"

# Stage the extension contents in a temp dir so we can transform the
# manifest without mutating the source tree.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$EXT_DIR"/. "$STAGE"/

# Filter dev-only host patterns out of the manifest for the published build.
node -e "
const fs = require('fs');
const path = '$STAGE/manifest.json';
const isDevHost = (h) => /localhost|vercel\.app/.test(h);
const m = JSON.parse(fs.readFileSync(path, 'utf8'));
m.host_permissions = (m.host_permissions || []).filter((h) => !isDevHost(h));
m.content_scripts = (m.content_scripts || []).map((s) => ({
  ...s,
  matches: (s.matches || []).filter((mm) => !isDevHost(mm))
}));
fs.writeFileSync(path, JSON.stringify(m, null, 4) + '\n');
"

# Drop non-runtime icon source assets.
rm -f "$STAGE/icons/source.html"
rm -f "$STAGE"/icons/raw-*.png

(
  cd "$STAGE"
  zip -r "$OUT" . \
    -x '.*' \
    -x '*/.*' \
    -x '*.DS_Store' \
    > /dev/null
)

echo "packaged: $OUT"
echo "size:    $(du -h "$OUT" | cut -f1)"
echo "version: $VERSION"
echo ""
echo "manifest hosts in the zip (dev-only filtered):"
unzip -p "$OUT" manifest.json | node -e "
const m = JSON.parse(require('fs').readFileSync(0, 'utf8'));
for (const h of (m.host_permissions || [])) console.log('  host:', h);
for (const s of (m.content_scripts || [])) {
  for (const mm of (s.matches || [])) console.log('  match:', mm);
}
"
