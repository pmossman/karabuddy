# Brand assets

The icon art has ONE source: **`extension/icons/source.html`** (the vw-driven
launcher mark) — `KARA` in Barlow 400 (matches the **karabast** wordmark) over
`BUDDY` in Orbitron with the cyan→azure gradient (`#4dd2ff → #4d9dff`), on the
tactical-dark rounded square. The promo tiles use `extension/icons/promo-source.html`.
Same palette/fonts as the app (`app/_theme/karabuddyTokens.ts`).

## Regenerating — `scripts/generate-icons.sh`

Renders a high-res **2056×2056 master** (`karabuddy-icon-2056.png`) from
`source.html` via headless Chrome, then **downscales every size from that master**
with `sips` (single high-quality resample). Run it after editing `source.html`:

```sh
./scripts/generate-icons.sh
```

Outputs:
| Asset | Size | Path |
|---|---|---|
| Master (canonical source-of-resizes) | **2056×2056** | `assets/brand/karabuddy-icon-2056.png` |
| Extension manifest icons | **16 / 48 / 128** | `extension/icons/{16,48,128}.png` |
| CWS store icon | **128×128** | `assets/store/store-icon-128.png` |
| Discord app icon (masked to a circle) | **1024×1024** | `assets/discord/karabuddy-1024-square.png` |
| CWS promo tiles *(optional)* | 440×280 / 920×680 / 1400×560 | `assets/store/promo-*.png` |

To pull any other size, downscale from the master:
`sips -z <px> <px> assets/brand/karabuddy-icon-2056.png --out <dest>`.

## Screenshots — `assets/store/screenshot-*.png` (1280×800)

Captured from the running app (signed in) via agent-browser at `viewport 1280 800`
(DSF 1 → exact pixels), Next dev badge hidden. Pages: home / viewer / replays /
teams / tagging.

## Required listing dimensions (uploaded manually to the dashboards)

- **Chrome Web Store:** icon 128×128, screenshots 1280×800 (1–5), optional promo
  tiles 440×280 + 1400×560.
- **Discord Developer Portal:** app icon 1024×1024 (= bot avatar; masked to a circle).
