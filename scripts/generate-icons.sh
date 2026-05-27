#!/usr/bin/env bash
# Regenerate the extension's icon PNGs + Chrome Web Store listing assets.
#
# Uses headless Google Chrome to render extension/icons/source.html (square
# launcher icon, vw-driven so it crisply scales to any size) and
# extension/icons/promo-source.html (rectangular promo tile with logo +
# tagline) at the sizes Chrome / Chrome Web Store want.
#
# Outputs:
#   extension/icons/{16,48,128}.png    — extension manifest icons
#   assets/store/icon-128.png          — Web Store listing icon (same art)
#   assets/store/promo-440x280.png     — Web Store "small promo tile"
#   assets/store/promo-920x680.png     — Web Store "large promo tile"
#   assets/store/promo-1400x560.png    — Web Store "marquee promo tile"
#
# Requires Google Chrome at the standard macOS location. Fonts are pulled
# from Google Fonts (Barlow); --virtual-time-budget gives the network
# request time to land before screenshot.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "$CHROME" ]]; then
  echo "error: Google Chrome not found at $CHROME" >&2
  exit 1
fi

ICON_SRC="file://$REPO_ROOT/extension/icons/source.html"
PROMO_SRC="file://$REPO_ROOT/extension/icons/promo-source.html"
ICON_OUT="$REPO_ROOT/extension/icons"
STORE_OUT="$REPO_ROOT/assets/store"
mkdir -p "$STORE_OUT"

render() {
  local src="$1"
  local out="$2"
  local w="$3"
  local h="$4"
  local userdata
  userdata="$(mktemp -d)"
  # Hard 30s ceiling per render — Chrome occasionally hangs in headless mode
  # waiting for network resources that never resolve (especially Google Fonts
  # on a cold cache). Background + wait + kill pattern works on macOS without
  # GNU `timeout` being installed.
  (
    "$CHROME" \
      --headless \
      --disable-gpu \
      --hide-scrollbars \
      --user-data-dir="$userdata" \
      --default-background-color=00000000 \
      --window-size="${w},${h}" \
      --virtual-time-budget=3000 \
      --screenshot="$out" \
      "$src" \
      > /dev/null 2>&1 &
    local pid=$!
    ( sleep 30 && kill -9 $pid 2>/dev/null ) &
    local watchdog=$!
    wait $pid 2>/dev/null
    kill -9 $watchdog 2>/dev/null
  )
  rm -rf "$userdata"
  if [[ ! -s "$out" ]]; then
    echo "error: failed to render $out (timed out or returned empty)" >&2
    exit 1
  fi
  echo "  ${w}x${h}  →  $out  ($(du -h "$out" | cut -f1))"
}

echo "rendering square icons from source.html…"
render "$ICON_SRC" "$ICON_OUT/16.png" 16 16
render "$ICON_SRC" "$ICON_OUT/48.png" 48 48
render "$ICON_SRC" "$ICON_OUT/128.png" 128 128
render "$ICON_SRC" "$STORE_OUT/icon-128.png" 128 128

echo "rendering promo tiles from promo-source.html…"
render "$PROMO_SRC" "$STORE_OUT/promo-440x280.png" 440 280
render "$PROMO_SRC" "$STORE_OUT/promo-920x680.png" 920 680
render "$PROMO_SRC" "$STORE_OUT/promo-1400x560.png" 1400 560

echo ""
echo "done."
