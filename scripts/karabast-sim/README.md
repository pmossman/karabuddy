# karabast-sim — local extension validation (B219)

A dependency-free fake karabast that replays an anonymized real game to a
REAL unpacked extension over both transports (WebSocket + engine.io polling),
with automatic PASS/FAIL assertions. Built to validate the B219
transport-agnostic capture fix (replays truncating when karabast's socket.io
reconnects and falls back to HTTP polling, which the WebSocket-only proxy
couldn't see).

## One-time setup (~2 min)

```sh
npm run db:dev:up && npm run dev     # terminal 1 — karabuddy dev on :3001
npm run sim:karabast                 # terminal 2 — fake karabast on :4517
```

1. `chrome://extensions` → Developer mode → **Load unpacked** → `<repo>/extension`
   (or hit **Reload** ↻ on the KaraBuddy card if already loaded — the manifest
   gained a `localhost:4517` dev host, so a reload is required either way).
2. Pin uploads to your local dev server: on the KaraBuddy card click
   **service worker** → in that console run:
   ```js
   chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3001' })
   ```
   ⚠️ Skip this and sim uploads go to **prod** karabuddy.app (the page will
   flag it in red if that happens — delete the stray replay from /replays).

## Run the scenarios (~2 min)

Open **http://localhost:4517** — the status bar shows extension-injected +
dev-server-up. Click, in any order (each takes 10–20 s and shows PASS/FAIL):

- **Scenario A** — full game over polling/XHR: the new capture path,
  end-to-end through finalize → upload → a clickable local replay link
  (opens in the redesigned viewer — doubles as a decode/viewer check).
- **Scenario B** — *the production bug*: WS streams half the game, the server
  yanks the socket (code 1006), the rest arrives over polling/fetch. Asserts
  all frames captured, the 6-frame overlap dedups, and `diag` recorded
  `ws-close` → `poll-active`. Mid-run the socket-close flush + final merge
  also exercise the server's B120 slice-merge against local dev.
- **Scenario C** — spectator guard: `spectator=true` traffic must record
  nothing.

> **Blob side effect:** local-dev uploads store their payload blob in the
> REAL Vercel Blob store (`.env.local` carries the prod blob token; the local
> override only redirects Postgres). Sim uploads therefore leave small
> orphaned `replays/<slug>.json` blobs (anonymized fixture data; the slugs
> exist only in your local DB). To keep sim uploads fully local instead, add
> `KARABUDDY_BLOB_MODE=memory` to `.env.development.local` — or delete the
> strays afterwards with `@vercel/blob`'s `del()`.

## Real-site smoke (optional, ~5 min)

With the endpoint still pinned to :3001, play one quick game on karabast.net
normally — recording toast, upload lands in local dev. To also force the
polling fallback on the real site: DevTools → Network → ⋮ → *Network request
blocking* → add pattern `*transport=websocket*` → play; capture should
continue (check `window.__KaraBuddy.replays.Recorder.getDiag()` in the
console — `transport: 'polling'`). If Chrome doesn't block the WS upgrade the
test is inconclusive (diag shows `websocket`), not a failure.

**Un-pin when done:** in the SW console
`chrome.storage.local.remove('karabuddyEndpoint')` — or your real games
upload to localhost.

## Files

- `server.mjs` — sim server (page + `/karabast/poll` + raw-WS `/karabast/ws`,
  per-run game ids, synthetic `totalMessages` merge keys).
- `index.html` — harness page; drives traffic and asserts against
  `window.__KaraBuddy.replays.Recorder` (same MAIN world).
- `fixture.json` — anonymized 71-frame gamestate sequence from a real game
  (chat/log stripped, usernames replaced). Regenerate from any payload:
  `node scripts/karabast-sim/make-fixture.mjs <payload.json> Old=New ...`

The `localhost:4517` manifest matches are dev-only — `package-extension.sh`
strips them from published builds (verified: the packaged zip's manifest has
zero localhost references).
