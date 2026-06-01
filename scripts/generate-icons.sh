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

# Square icon: render ONE high-res 2056² master from source.html, then downscale
# every size from it with `sips` (single high-quality resample). The master is
# the canonical art (committed) so any size can be re-derived later. The gradient
# BUDDY has no glow, so it stays crisp down to 128.
BRAND_OUT="$REPO_ROOT/assets/brand"
MASTER="$BRAND_OUT/karabuddy-icon-2056.png"
mkdir -p "$BRAND_OUT"
echo "rendering 2056² master from source.html…"
render "$ICON_SRC" "$MASTER" 2056 2056

echo "downscaling icon sizes from the master…"
for sz in 16 48 128; do sips -z "$sz" "$sz" "$MASTER" --out "$ICON_OUT/$sz.png" >/dev/null; echo "  ${sz}²  →  $ICON_OUT/$sz.png"; done
sips -z 128 128 "$MASTER" --out "$STORE_OUT/store-icon-128.png" >/dev/null;     echo "  128²  →  $STORE_OUT/store-icon-128.png"
sips -z 1024 1024 "$MASTER" --out "$REPO_ROOT/assets/discord/karabuddy-1024-square.png" >/dev/null; echo "  1024² →  assets/discord/karabuddy-1024-square.png (Discord app icon; masked to a circle)"

echo "rendering promo tiles from promo-source.html (rectangular — rendered natively, not from the square master)…"
render "$PROMO_SRC" "$STORE_OUT/promo-440x280.png" 440 280
render "$PROMO_SRC" "$STORE_OUT/promo-920x680.png" 920 680
render "$PROMO_SRC" "$STORE_OUT/promo-1400x560.png" 1400 560

echo ""
echo "done."
