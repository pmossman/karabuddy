# Progress log

Append a dated entry each work session (newest at top). Keep it a log of what
happened + what's next, not a design doc (that's `ux-design.md`).

## 2026-07-15 — migration tool: design + interactive prototype

- Read Andy's "first-class replays" plan; captured its implications in `context.md`
  (unlinked replays + connect-to-deck + import pipeline + the `isHidden` fix).
- Confirmed the **killer insight**: karabuddy stores each recorder's full 50-card
  list + sideboard, so migration can auto-create *real* swuforge decks (Andy's own
  replays can't), cluster replays under them by version, and pre-link.
- Set up this folder as the project's durable context (README/context/ux-design/
  open-questions/progress + Andy's plan copy).
- Designed the team-owner migration UX (see `ux-design.md`) and built an
  interactive click-through **prototype** at `prototype/migration-tool.html`
  (faked data, karabuddy cockpit aesthetic + a forge-ember accent for swuforge).
  Artifact: https://claude.ai/code/artifact/7339bdba-02bd-49b8-a26a-df3c92ea0322
  (verified end-to-end via a jsdom smoke test — all 6 steps, no JS errors).
- Applied Andy's `isHidden` converter fix (REPLAYHIDDEN sentinel → true hidden
  card / card back); round-trip still 60/60, 144 hidden cards emit correctly.
- **Next:** get Parker's calls on open-questions 7–13 (team model, consent,
  version aggressiveness, naming, entry point); apply the `isHidden` converter fix;
  await Andy on the sample blobs + deck/team ingest surface (Q1–6).

## Earlier (pre-folder, 2026-07-14) — see git log on branch explore/swuforge-replay-conversion

- Built + verified the replay→replay converter (800/800 round-trip, v3 chat).
- Sent Andy a sample pack of 8 anonymized converted v3 replays + README.
- Deck-derivation prototype (416 replays → 20 archetype decks) — shelved as a
  standalone, now folded into the migration as auto-deck-creation.
