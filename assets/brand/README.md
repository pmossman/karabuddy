# Brand assets

Source generators + exported assets for the store/Discord listings. The logo
wordmark = **KARA** in Barlow + **BUDDY** in Orbitron (uppercase) with the
cyan→azure gradient (`#4dd2ff → #4d9dff`) on the tactical-dark background — the
same palette/fonts as the app (see `app/_theme/karabuddyTokens.ts`).

## Required dimensions

**Chrome Web Store** (uploaded in the dev dashboard)
| Asset | Size | File |
|---|---|---|
| Store icon | 128×128 | `../store/store-icon-128.png` |
| Screenshots (1–5) | 1280×800 | `../store/screenshot-*.png` |
| Small promo tile *(optional)* | 440×280 | — |
| Marquee promo tile *(optional)* | 1400×560 | — |

**Extension package icons** (bundled, in `extension/manifest.json`)
| Size | File |
|---|---|
| 16 / 48 / 128 | `../../extension/icons/{16,48,128}.png` |

**Discord** (Developer Portal app icon = bot avatar)
| Asset | Size | File |
|---|---|---|
| App icon | 1024×1024 | `../discord/karabuddy-1024-square.png` (Discord masks to a circle) |

## Regenerating (no ImageMagick needed — render + downscale)

`app-icon.html` is the rounded-square mark (extension/store icon); `discord-icon.html`
is the circle-safe version (more padding). Render each with the agent-browser CLI
at 2× then downscale for crisp text:

```sh
agent-browser set viewport 1024 1024 2
agent-browser open "file://$PWD/assets/brand/app-icon.html"
agent-browser eval "await document.fonts.ready; await new Promise(r=>setTimeout(r,700))"
agent-browser screenshot '.icon' /tmp/raw.png
sips -z 1024 1024 /tmp/raw.png --out assets/brand/karabuddy-appicon-1024.png
# then slice: for sz in 16 48 128; do sips -z $sz $sz <src> --out extension/icons/$sz.png; done
```

Screenshots: sign in, `agent-browser set viewport 1280 800`, navigate to each page,
hide the Next dev badge (`nextjs-portal{display:none}`), `screenshot`.
