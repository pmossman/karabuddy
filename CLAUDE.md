# karabuddy

Hosted companion to karabast.net for Star Wars Unlimited. Replays, tags, solo testing, and review tools.

## Stack

- Next.js 16 App Router (TypeScript)
- Neon Postgres + Drizzle ORM
- Vercel Blob (replay payload storage)
- Deployed on Vercel

## Layout

- `app/` — Next.js routes (replays at `/r/[slug]`, API at `app/api/`)
- `lib/` — shared backend (db client, schema)
- `drizzle/` — generated migrations

## Auth (intentional non-decision)

No login system yet. Each extension install generates an opaque `installToken` stored in localStorage; uploads + tags are attributed to that token. Add Discord/Google OAuth when moderation or profile-claiming demands it — not before.

## Related repos

- `~/code/karabast-extension/` — the Chrome MV3 extension. Captures replays from karabast.net and uploads them here.
- `~/code/karabast-dev/forceteki-client/` — karabast's open-source frontend (MIT). We lift the gameboard renderer from it for the `/r/[slug]` viewer; **don't** maintain a literal fork — copy what we need, keep their LICENSE for the lifted files, evolve independently.

## Backlog

[BACKLOG.md](./BACKLOG.md) is the source of truth for outstanding work. The file's top-of-file conventions section explains the format; the autonomous loop expects:

1. Read `## Backlog` top-down — that's priority order.
2. Pick the first task whose acceptance criteria you can satisfy in this run.
3. Move the entire task block from `## Backlog` to `## In Progress`, adding `_claimed: <ISO timestamp> by <agent name>_` at the top.
4. Implement. Update files as needed, run tests/build.
5. Move the block to the top of `## Done` with `_completed: <ISO date> by <agent>_` and a one-line summary of what shipped.
6. Commit the BACKLOG.md change along with the implementation diff so the next loop iteration sees the updated state.

New tasks: append to `## Backlog` with the next free `[BN]` id and the four standard fields (Why / Acceptance / Refs).
