# karabuddy

Hosted companion to [karabast.net](https://karabast.net) for Star Wars Unlimited. Replay capture, mid-game tagging, and a viewer for reviewing matches frame-by-frame.

Live at **[karabuddy.app](https://karabuddy.app)**.

Fan project. No affiliation with Fantasy Flight Games, Asmodee, or Lucasfilm.

## What it is

Two pieces that lean on each other:

- **Webapp** (Next.js, this repo's root): hosts the replay viewer at `/r/[slug]`, a public/private replay browser at `/replays`, account claim + settings, and the `/install` walkthrough.
- **Chrome extension** ([`./extension/`](./extension)): captures karabast.net matches in the background, lets you drop tags on key moments mid-game from a floating launcher, and uploads finalized replays to the webapp.

The extension is the only thing that can run on karabast.net itself (intercept the WebSocket, inject UI). The webapp owns everything else.

## Install the extension

[karabuddy.app/install](https://karabuddy.app/install) for the walkthrough. Until the Chrome Web Store listing is live it's load-unpacked from a release zip — see the [latest release](https://github.com/pmossman/karabuddy/releases).

## Stack

- Next.js 16 App Router (TypeScript)
- Neon Postgres + Drizzle ORM
- Vercel Blob for replay payload storage
- Auth.js v5 (Discord + Google) for sign-in
- Chrome MV3 plain-JS extension (no build step)
- Deployed on Vercel

## Layout

- `app/` — Next.js routes (`/r/[slug]`, `/replays`, `/claim`, `/settings`, `/install`) + API at `app/api/`
- `lib/` — shared backend (db client, schema, replay decoder)
- `drizzle/` — generated migrations
- `extension/` — Chrome MV3 extension (excluded from the Next.js build via `.vercelignore` + `tsconfig.json`)
- `BACKLOG.md` — running dev log

## Dev setup

```sh
npm install
vercel env pull .env.local    # pulls Neon, Vercel Blob, Auth.js secrets
npm run dev                   # http://localhost:3000
```

For the extension to upload to your local server instead of prod, set the override in DevTools on any karabast.net tab:

```js
chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3000' })
```

Then load `./extension/` unpacked at `chrome://extensions` (Developer mode on). Reload from `chrome://extensions` after editing extension files — no build step.

## Status

Pre-1.0. The webapp + extension are deployed and capturing real matches. Major recent moves: extension stripped down to ~2200 lines (a small floating launcher + WebSocket recorder + bridge), in-place playback removed (the webapp owns the viewer), solo-testing surface removed (planned to return inside the webapp via forceteki, not by automating karabast.net). See [BACKLOG.md](./BACKLOG.md) for the running log.

## License

Not yet declared — copyright reserved by the contributors for now. Karabast-derived code carries the upstream MIT license in the files where it appears.
