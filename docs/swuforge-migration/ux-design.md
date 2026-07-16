# Migration tool — UX design

The team-owner migration flow. Interactive prototype (faked data):
`prototype/migration-tool.html` → published Artifact:
**https://claude.ai/code/artifact/7339bdba-02bd-49b8-a26a-df3c92ea0322**

## The core problem this design solves

swuforge is **deck-first** (a replay hangs off a decklist); karabuddy is
**replay-first**. A naive migration would dump raw replays that don't fit
swuforge's model. Two things resolve it:

1. **Andy's "first-class replays"** lets a replay exist unlinked → replays can
   land even without a deck.
2. **karabuddy has the full decklist** each game was played with → we don't just
   import replays, we **rebuild the team's decks** and hang the replays off them.
   That flips the migration from "data dump" to "here's your team, as decks" —
   which is exactly swuforge's native shape, *and* it adds value karabuddy never
   surfaced (versions, per-deck win-rate). This is the whole pitch.

## Design principles

- **Lead with the magic, not the mechanics.** The hero and step 3 sell "your
  team, rebuilt as decks with versions + stats," not "we convert PersistedTimeline
  blobs." The user sees value before they see plumbing.
- **Additive & reversible in tone.** Every screen reassures "nothing in karabuddy
  changes." Migration is a copy, consent-gated, own-data-only.
- **karabuddy's cockpit skin, forge-ember for the destination.** The tool lives in
  karabuddy so it wears karabuddy's neon-dark system; a single ember accent
  (`#ff7a3d`) marks everything that IS swuforge (folder, "Open in Forge", the
  migrate CTA), so the two apps read as two worlds.
- **Summary before detail.** Stat strips up top; expandable detail below.

## The flow (6 steps)

1. **Start** — value pitch for the team owner: 412 games → 7 complete decks +
   versions + stats + watchable replays. One CTA.
2. **Connect Forge** — OAuth (Google/Discord, shared identity → auto-match, no
   manual linking). Then choose the destination **team folder** (a karabuddy team
   → a swuforge team folder).
3. **Review decks** (the centerpiece) — auto-built decks, each with: aspect-tinted
   leader tile, editable name, games / W–L / win% readout, **detected versions**
   (from decklist diffs over time, with per-version WR), the **recovered 50-card
   list + sideboard**, who-played-it, and per-deck include toggle. "Magic" chips
   flag what was auto-detected (versions, sideboard recovered, pilots). A second
   tab holds **standalone replays** — games with no complete list (partial /
   pre-B42), imported unlinked with a "connect to a deck later" option (Andy's M4).
4. **Teammates** — each member matched to their Forge profile by Google/Discord;
   unmatched members get an invite (their replays wait in the folder until claimed).
   Per-member include toggle.
5. **Confirm** — exact summary of what lands + consent checkboxes (own data only;
   exclude E2EE-encrypted replays).
6. **Migrating → Done** — progress ticker → success recap + **Open in SWU Forge** +
   the "keep both apps" note (new games keep flowing; Forge replays play in the
   karabuddy viewer).

## "Magical" features (the value-add, in priority order)

1. **Auto-built complete decks** — real 50 + sideboard from karabuddy's stored
   lists, not the leader/base stubs Andy's own replays are limited to.
2. **Version detection** — cluster an archetype's dated full lists into versions;
   show the diff + per-version win-rate. Data exists (dated lists per game);
   algorithm TBD (see open-questions Q9).
3. **Per-deck stats on arrival** — win-rate, W–L, who-played-what, date span.
   (Matchup spread is a natural extension — karabuddy has opponent leader/base.)
4. **Pilots / sideboard recovery** flags — surface what was reconstructed.
5. **Standalone replays** for fragments — nothing is lost; connect later.

## Decisions baked into the prototype (revisit with Parker — open-questions.md)

- **Team model = owner migrates the team's shared games into one Forge team
  folder**, teammates matched + invited (open-Q7 option a). The owner drives; each
  member's games attribute to them.
- **One deck per archetype, versions nested inside** (not a deck per version) —
  keeps the list scannable; versions are the swuforge `DeckVersion`/branches.
- **Everything included by default**, opt-out per deck/member — the "migrate my
  whole team" ask wants momentum, not a blank multi-select.
- **Consent = two checkboxes** (own-data, exclude-encrypted), not per-item — low
  friction, still explicit.

## Known gaps / not-yet-designed

- **Member consent/privacy** for a teammate's data migrating under the owner's
  action — the prototype invites unmatched members but doesn't model a teammate
  *approving* the export of their games. Real design needs a per-member consent or
  a "claim your data" model. **Flag for Parker.**
- **Deck naming** — auto "Leader — Epithet"; users may want archetype names.
- **Matchup stats** screen not shown (mentioned only).
- **Reciprocal viewer** (swuforge replay in karabuddy) surfaced as a Done-screen
  note only; separate feature.
- Card lists in the proto are representative samples, not real 50s.

## To turn this into a real feature (rough)

Entry: a `/teams/[slug]/migrate` page or team-settings tab. Reuse
`lib/sideboardGuides.buildArchetypes` + `prototype-user-deck-export` derivation
(scoped to the team's shared replays), `prototype-replay-to-swuforge` for the
blobs, `lib/userResolution` for member/identity scope. Depends on Andy exposing a
deck-create + replay-import + team-folder ingest (open-questions Q4–6).
