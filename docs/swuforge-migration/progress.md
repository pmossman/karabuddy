# Progress log

Append a dated entry each work session (newest at top). Keep it a log of what
happened + what's next, not a design doc (that's `ux-design.md`).

## 2026-07-15 (later 3) — rebuilt on karabuddy's design system (React)

- Per Parker: the demo must use karabuddy's real components, not a bespoke embed.
  Rebuilt `/migrate-demo` as a **React client component** (`app/migrate-demo/
  page.tsx`) on the actual design system — `Panel`, `LedToggle`, `Segmented`,
  `LeaderBasePair` (real card art), `TacticalHeading`, `glow`/`ghost` buttons,
  `tokens`, `KaraBuddyThemeProvider`. Deleted the iframe/`public/` embed.
- Left progress rail is now **jump-clickable** (Parker's ask) — any section.
- Kept the progressive karabuddy→Forge accent shift as a light layer over the
  constant karabuddy components (accent cyan→ember per step, Forge branding
  fades in). Real card art via `/card-art/...` — fixed IDs to base-set printings
  that are synced locally (Vader JTL_006, SOR/ASH/SHD/JTL bases); dropped a
  duplicate version chip.
- Typecheck clean; verified in-browser (Start/Connect/Decks/Confirm). The HTML
  prototype stays as the design reference + Artifact.

## 2026-07-15 (later 2) — deployable in-app demo route

- Made the prototype a real, deployable karabuddy route: **`/migrate-demo`**
  (`app/migrate-demo/page.tsx`), OUTSIDE the `(app)` group so it renders
  full-screen without the sidebar shell. It embeds the self-contained prototype
  from `public/demos/swuforge-migration.html` (byte-identical to the reviewed
  version; no React port → zero regression risk). `noindex`, public, faked data.
- No CSP/frame headers in the app, so the inline-script prototype runs fine.
- Verified in the running dev app (chrome-devtools): full-screen, LED step-rail
  visible at desktop width, phase shift intact. Route + asset both 200.
- Source ↔ deployed-copy sync + regen command documented in `prototype/README.md`.
- A true React/TSX port under `(app)` is the follow-up if it becomes a real feature.

## 2026-07-15 (later) — prototype v2: progressive blend + plainer copy

- Viewed swuforge.com directly (warm purple-charcoal ground, steel wordmark +
  orange/blue fire vortex, reticle mark, orange→blue gradient borders; decks shown
  as leader+base card pairs with a PREMIER badge + "Leader · 30HP Aspect").
- Reworked the prototype per Parker: (1) rewrote copy to drop AI tells; (2) the
  aesthetic now **transitions per step** (`data-phase` 0→5) from karabuddy-cold to
  a merged karabuddy×Forge look — ground warms, the gradient heats azure→cyan to
  orange→blue, accent cyan→ember, the Forge wordmark/reticle fade in; cyan LED
  stays as karabuddy's through-line. Kept Forge's familiar deck-pair/badge/reticle.
- Verified in-browser (chrome-devtools) across phases; fixed a class-collision bug
  (`.s.led` inherited the rail LED-dot's circular bg → renamed `.s.live`).
- Artifact updated in place (same URL, v2-progressive-blend).

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
