# karabuddy → SWU Forge migration project

Project home for the **karabuddy → swuforge migration tool** + the broader
partnership. This folder is the durable context for coding agents: read it on
start, write to it as you go, so a fresh context can continue.

## What this is

A team-owner-facing tool **in karabuddy** that migrates a team's decks + replays
into **SWU Forge** (swuforge.com, a SWU deckbuilder). The partnership is a
two-sided integration with **Andy**, the swuforge dev. Live app is karabuddy.app.

**The strategic bet:** karabuddy is replay-first; swuforge is deck-first. Because
karabuddy stores each recorder's *full 50-card list + sideboard* (from karabast's
lobbyState), the migration can **auto-create real, complete swuforge decks**,
cluster the team's replays under them by version, and pre-link — migration that
*adds value* on day one (detected versions, win-rates, matchups) rather than just
copying data. Andy's "first-class replays" work (see `context.md`) makes replays
importable even when a complete deck can't be formed.

## Files in this folder

| file | what it holds |
|---|---|
| `README.md` | this index + how to use the folder |
| `context.md` | **verified technical facts** — formats, conversion status, what karabuddy stores, Andy's plan, known fixes. The knowledge base. |
| `ux-design.md` | the migration tool's UX — the flow, screens, the deck-first bridge, the "magic" features |
| `open-questions.md` | decisions to resolve (with Parker / with Andy) |
| `progress.md` | **running log** — dated entries; append here every work session |
| `andy-first-class-replays-plan.md` | Andy's implementation plan (his side), copied for reference |
| `prototype/migration-tool.html` | the interactive click-through prototype (faked data) — publish via the Artifact tool |

## How to use this folder (for agents)

1. Read `context.md` (facts) + `progress.md` (where we left off) first.
2. Do the work. If you learn a durable fact, add it to `context.md`; if you make
   or need a decision, log it in `open-questions.md`.
3. Append a dated entry to `progress.md` before you finish.
4. The converter + prototypes live at repo root `scripts/prototype-*.ts` and this
   folder's `prototype/`. Branch: `explore/swuforge-replay-conversion`.

## Status (2026-07-15)

- ✅ Replay→replay converter proven (`scripts/prototype-replay-to-swuforge.ts`):
  800/800 board round-trip, v3 chat, ~7KB/game. Sample pack sent to Andy.
- ✅ Andy shared his "first-class replays" plan (replays decoupled from decks).
- 🔨 **Now:** designing + prototyping the team-owner migration tool UX.
- ⏳ Next: Andy confirms sample blobs render; pick handoff mechanic; build for real.
