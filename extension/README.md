# KaraBuddy — Chrome extension

Companion extension for [karabast.net](https://karabast.net), the unofficial Star Wars Unlimited web client. Captures every match you play and lets you tag key moments inline; review and share replays on [karabuddy.app](https://karabuddy.app).

This is the in-tree copy that ships with [karabuddy.app](https://karabuddy.app). It is a fan project with no affiliation with Fantasy Flight Games, Asmodee, or Lucasfilm.

## What it does

- **Background recording** — captures every game you play on karabast.net automatically and uploads the payload to karabuddy.app on game-end.
- **Floating launcher** — small draggable button on karabast.net. Expands in place into a tag panel during a match (REC indicator, `+ Tag this moment` with inline comment, recent tags list, link to open the uploaded replay on karabuddy.app). Doubles as a launcher into karabuddy.app when no match is active.
- **Status toasts** — pill notifications pop out of the launcher for background events: recording started, tag saved, replay uploaded, upload failed.
- **Toolbar icon** — single click opens your replays on karabuddy.app.

## Install (load unpacked, for now)

Until the Chrome Web Store listing is live, install manually:

1. Download or clone this repo.
2. Open `chrome://extensions` in a new tab.
3. Toggle **Developer mode** in the top-right.
4. Click **Load unpacked** and select the `extension/` directory.
5. Pin the extension to your toolbar for quick access.

The site walkthrough at <https://karabuddy.app/install> mirrors these steps.

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
- **Replay payloads upload to karabuddy.app by default.** Override the endpoint via `chrome.storage.local.karabuddyEndpoint` if you're self-hosting.

## Repo layout

This directory is included verbatim in the karabuddy monorepo and is excluded from the Next.js build via `.vercelignore` + `tsconfig.json`. See the root `CLAUDE.md` for the development workflow (load-unpacked, reload after edits — no build step).

## License

See the root repo. Karabast-derived UI code carries the upstream MIT license in the files where it appears.
