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

- `app/` — Next.js routes (`/r/[slug]`, `/replays`, `/teams`, `/mentions`, `/settings`, `/claim`, `/install`) + API at `app/api/`
- `lib/` — shared backend (db client, schema, replay decoder)
- `drizzle/` — generated migrations
- `extension/` — Chrome MV3 extension (excluded from the Next.js build via `.vercelignore` + `tsconfig.json`)
- `BACKLOG.md` — running dev log

## Dev setup

`.env.local` (from `vercel env pull`) carries the **production** Neon connection — local dev runs against a local Docker Postgres instead, never prod:

```sh
npm install
vercel env pull .env.local    # prod Neon + Blob + Auth secrets — used as the snapshot SOURCE only
# create .env.development.local (gitignored, higher precedence): KARABUDDY_DB_DRIVER=pg + a
# localhost:5434 POSTGRES_URL / POSTGRES_URL_NON_POOLING
npm run db:dev:up             # Docker Postgres on :5434
npm run db:pull-snapshot      # seed it from a read-only prod dump
npm run dev                   # http://localhost:3001
```

See [docs/local-dev-db.md](./docs/local-dev-db.md) for the full local-DB rationale and workflow.

For the extension to upload to your local server instead of prod, set the override in DevTools on any karabast.net tab (dev runs on :3001, off :3000 so the extension bridge can't auto-pin your real uploads to local):

```js
chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3001' })
```

Then load `./extension/` unpacked at `chrome://extensions` (Developer mode on). Reload from `chrome://extensions` after editing extension files — no build step.

## Tests

Layers, each runnable independently:

```sh
# Unit — pure logic, no infra. Fast (~1s).
npm run test:unit

# API integration — route handlers against a DB. Default driver is pglite
# (in-process Postgres) — NO Docker needed.
npm run test:api
# For a real-Postgres run instead: start Docker (:5433), then test:api:pg
npm run test:db:up
npm run test:api:pg

# E2E — Playwright drives a real browser. Builds with pglite + in-memory Blob.
npm run test:e2e:install   # one-time: install Chromium
npm run test:e2e

# Everything (unit + api + e2e)
npm test
```

Test scaffolding:
- `lib/*.test.ts` + `test/unit/*.test.ts` + `extension/**/*.test.js` — unit tests (incl. the commentScope parity + migration-journal guards)
- `test/api/*.test.ts` — API integration tests (vi.mock of `@/auth` per test; real Drizzle, pglite by default)
- `test/e2e/*.spec.ts` — Playwright E2E (test sign-in via `/api/test/sign-in`, in-memory Vercel Blob)
- `test/smoke/*.spec.ts` — smoke against a real prod build (`playwright.smoke.config.ts`); CI-only, the deploy gate

The Docker test Postgres lives on port 5433 (the local **dev** DB is a separate container on 5434). CI runs the full suite on PRs via `.github/workflows/test.yml` (Postgres service container); pushes to `main` are gated by `deploy.yml`, which runs the same suite before deploying.

## Status

Pre-1.0. The webapp + extension are deployed and capturing real matches. Major recent moves: extension stripped down to ~2200 lines (a small floating launcher + WebSocket recorder + bridge), in-place playback removed (the webapp owns the viewer), solo-testing surface removed (planned to return inside the webapp via forceteki, not by automating karabast.net). See [BACKLOG.md](./BACKLOG.md) for the running log.

## License

Not yet declared — copyright reserved by the contributors for now. Karabast-derived code carries the upstream MIT license in the files where it appears.
