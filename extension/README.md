# KaraBuddy — Chrome extension

Companion extension for [karabast.net](https://karabast.net), the unofficial Star Wars Unlimited web client. Adds replay capture, replay playback, mid-game tagging, and a solo-testing mode for one-window deck testing.

This is the in-tree copy that ships with [karabuddy.com](https://karabuddy.com). It is a fan project with no affiliation with Fantasy Flight Games, Asmodee, or Lucasfilm.

## What it does

- **Replay record** — captures every game you play on karabast.net automatically and uploads the payload to karabuddy.com for sharing and review.
- **Replay playback** — adds a footer button on karabast.net that lets you scrub through any uploaded replay frame-by-frame inside the live game UI.
- **Tagging** — drop labeled bookmarks on specific frames mid-game (or post-game in the viewer) so you can jump back to key moments.
- **Solo testing** — runs both seats of a karabast match in one browser window, with a Cmd/Ctrl+Shift+S hotkey to swap focus. Great for piloting goldfish lines without queuing.
- **Sidebar overlay** — small in-page UI on karabast.net for record/playback controls; doesn't touch the game DOM.

## Install (load unpacked, for now)

Until the Chrome Web Store listing is live, install manually:

1. Download or clone this repo.
2. Open `chrome://extensions` in a new tab.
3. Toggle **Developer mode** in the top-right.
4. Click **Load unpacked** and select the `extension/` directory.
5. Pin the extension to your toolbar for quick access.

The site walkthrough at <https://karabuddy.com/install> mirrors these steps.

## Packaging a release zip

From the repo root:

```sh
npm run package:extension
```

This runs `scripts/package-extension.sh`, which produces `dist/karabuddy-extension-<version>.zip` with `manifest.json` at the zip root (the layout Chrome Web Store expects). The version is read from `extension/manifest.json`.

## Limitations / known caveats

- **Chrome only.** The MV3 manifest targets Chromium browsers (Chrome, Brave, Edge in Chromium mode). Firefox and Edge support are planned but require minor manifest tweaks (`browser_specific_settings`, background page vs service worker, etc.).
- **Karabast-specific.** Hooks into karabast.net's WebSocket frames; will break if karabast significantly reshapes its protocol. We track upstream and patch as needed.
- **Fan project.** No affiliation with FFG/Asmodee/Lucasfilm. Star Wars: Unlimited and all associated marks belong to their owners.
- **Replay payloads upload to karabuddy.com by default.** Toggle visibility in the popup if you want them private to your install.

## Repo layout

This directory is included verbatim in the karabuddy monorepo and is excluded from the Next.js build via `.vercelignore` + `tsconfig.json`. See the root `CLAUDE.md` for the development workflow (load-unpacked, reload after edits — no build step).

## License

See the root repo. Karabast-derived UI code carries the upstream MIT license in the files where it appears.
