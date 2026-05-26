#!/usr/bin/env bash
# Zip the chrome extension for release / Chrome Web Store submission.
# Output: dist/karabuddy-extension-<version>.zip
#
# manifest.json sits at the zip root (Chrome's requirement), not inside an
# `extension/` subdir. Dotfiles (.DS_Store etc.) are excluded.
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

# zip from inside the extension dir so paths in the archive are
# relative to it (manifest.json at the root, not extension/manifest.json).
(
  cd "$EXT_DIR"
  zip -r "$OUT" . \
    -x '.*' \
    -x '*/.*' \
    -x '*.DS_Store' \
    > /dev/null
)

echo "packaged: $OUT"
echo "size:    $(du -h "$OUT" | cut -f1)"
echo "version: $VERSION"
