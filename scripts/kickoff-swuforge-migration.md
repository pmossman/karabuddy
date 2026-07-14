# Kickoff: karabuddy → swuforge partnership + one-click deck migration

You are the **primary session for exploring a partnership with the developer of
swuforge** (https://swuforge.com), a Star Wars Unlimited deckbuilder. The
near-term concrete deliverable Parker wants: **easy one-click migration of a
user's data from karabuddy → swuforge.**

Read `CLAUDE.md` + `CONTEXT.md` first (they auto-load) for the karabuddy domain.
This doc carries the swuforge facts + a **verified karabuddy data-portability
map** a prior session dug out of the schema/auth/API surface, so you don't
re-derive them.

**This is exploration-FIRST.** swuforge is a partner, not a spec handed to us —
the integration is two-sided (karabuddy exports, swuforge ingests) and neither
side exists yet. Agree the wire format + handoff with the swuforge dev **before**
building any speculative export/import plumbing. Don't ship a `/api/export/me`
into the void.

---

## The idea (Parker's framing)

karabuddy and swuforge are **complementary, not competitive**: karabuddy is
replay-capture + review + teams + stats; swuforge is deck building + card search.
A karabuddy user who's played a bunch of games has, sitting inside their replays,
the decklists they actually ran — and swuforge is where you'd want to *tune* those
lists. So the natural bridge is: **take the decks a user has played on karabuddy
and drop them into swuforge as saved decks, in one click.**

The partnership is broader than the one migration (cross-linking, funnels both
ways, maybe reciprocal import), but the migration is the tracer bullet that
proves the relationship and the plumbing. Land that first.

---

## What swuforge is (verified from public sources — CONFIRM specifics with the dev)

From swuforge.com + its docs (https://swu-forge.gitbook.io/docs) as of 2026-07:

- A **card database + deck builder** for SWU. Plain-language search (its own
  "Forge" syntax + a Scryfall-compatible syntax), browse all cards, **build /
  save / share / export decks**, public decks at `/public-decks`, a subscription
  tier at `/subscribe`.
- **Sign in with Google *or* Discord.** ← This is the same two OAuth providers
  karabuddy uses (`auth.ts`, Discord + Google). **This is the identity bridge**
  that makes "one-click" real: a user signed into both apps can be matched by
  Discord/Google account (or email) with no manual account-linking step.
- **NO replay / match-tracking / teams / stats concept.** swuforge is about
  decks. That's the single most important framing fact: of everything karabuddy
  holds, **only decks have a home in swuforge.** Replays, tags, teams, drills,
  stats do not map onto swuforge's model — don't try to migrate them.
- **No publicly documented API, import format, or third-party OAuth.** Deck
  save/share/export exist but the wire format isn't published. So the ingest
  side is something the swuforge dev builds (or exposes) as part of the deal.
  **First questions for the dev** are in the open-questions section below.

**Do not assume swuforge internals.** Everything about *how* swuforge ingests a
deck (format, endpoint, auth) is unknown until the dev tells you — treat it as a
negotiation input, not a fact.

---

## The strategic shape (the two insights that drive the whole design)

1. **Decks are the only portable surface.** karabuddy doesn't store "decks" as
   first-class user objects — it stores **replays**, each embedding the
   recorder's full 50-card decklist + sideboard *for that game*. So "a user's
   decks" must be **derived**: cluster their replays by archetype (leader+base),
   pick a representative list per archetype. That derivation is the real
   engineering (and karabuddy already does most of it — see "Reuse in-repo").

2. **Shared OAuth = the one-click enabler.** Because both apps authenticate the
   same identities (Discord/Google), the handoff can *trust* "this is the same
   human on both sides." That collapses the hardest part of cross-app migration
   (identity reconciliation) into a provider-account match.

---

## Karabuddy data-portability map (VERIFIED — trust these, don't re-derive)

Dug out of `lib/schema.ts`, `auth.ts`, `lib/userResolution.ts`, `lib/cards.ts`,
`lib/replayDecoder.ts`, `lib/cors.ts`, and the `/api/me/*` handlers.

### What "this user's data" resolves to
- A karabuddy user is a UUID (`users.id`, Auth.js Drizzle adapter) with OAuth
  links in `accounts` (`provider` = discord/google, `providerAccountId`).
- **Anonymous capture:** every extension install mints an opaque install token
  `kbx_<uuid>` (`lib/installToken.ts`); uploads/tags attribute to the token.
  Signing in **claims** tokens (`extension_tokens` rows link token→user).
- So an export's scope = **session `userId` + ALL their linked `extension_tokens`**
  (every device/browser). Token-only (never-signed-in) users can only be
  exported by their specific install token. Resolution logic: `userResolution.ts`
  (session → linked token → anonymous).

### Where the decks live (the payload that matters)
- `replays.decks` (JSONB) — per playerId:
  `{ username, leader:{name,set,number}, base:{name,set,number}, deck:[{id,count}], sideboard:[{id,count}] }`.
- **Only the recorder's own POV is unmasked.** The local player gets the full
  50-card `deck` + `sideboard`; the **opponent's list is masked by karabast**
  (leader/base only; the rest is "seen cards" recovered from frame observation
  via `card_events`). → **Export the user's OWN lists only. Never opponents'
  partial lists.** (This is also a privacy line, not just a data-quality one.)
- Card identity is the **standard SWU scheme**: `cardId = ${SET}_${NNN}` (e.g.
  `SOR_001`), `lib/cards.cardIdFromSetNumber`. Deck entries are `{id:'SET_NNN',
  count}`. swuforge, using the same SWU card registry, will recognize these
  identically — **decks are directly portable** if we agree on this shape.
- The `cards` catalog (`cards` table) is seeded from **swu-db** and self-heals
  unknown cards from payloads. Bases carry a functional identity
  (`lib/baseIdentity`, `baseAbilityHash`, `baseSubtype` force/splash) if you need
  to normalize/label a base beyond its name.

### The rest of the schema (context — NOT migration targets for swuforge)
Replays (metadata + blob payload of frames), `tags` (frame-anchored comments,
team-scoped), `clips`, `teams`/`team_members`/`replay_team_shares`, the drills
(`replay_openings`/`opening_responses`, `replay_sideboards`/`sideboard_responses`,
`sideboardTakes`), stats (`matches`/`match_players`/`card_events`). All
per-user-keyed and *technically* exportable, but **none of it has a destination
in swuforge.** List them to Parker only if the partnership grows beyond decks.

### What export/handoff plumbing already exists
**Effectively none for this.** Verified:
- No bulk-export endpoint. `/api/me/*` (`whoami`, `clips`, `mentions`,
  `settings`, `extensions`) each dump a slice, authed by session **or**
  `X-Install-Token` header — a pattern to reuse, not a solution.
- `GET /api/replays` is paginated + public-or-owned; not a bundle.
- **No OAuth-for-third-parties, no API keys, no scoped bearer tokens.** Auth.js
  is Discord+Google login only. There is no mechanism today to let swuforge pull
  on a user's behalf.
- CORS (`lib/cors.ts`) allows karabast.net + localhost:3000 + `chrome-extension://`
  only. **swuforge's origin is not allowed** — a browser-side cross-app fetch
  would need it added (a deliberate, reviewable change).

### Hard constraint — E2EE teams (B170 / ADR 0010)
Private-mode teams' replay payloads are **ciphertext server-side**; the server
can never decode them. Any *server-side* deck extraction excludes encrypted
replays (`replays.encrypted = true`). Same limit the drills hit. A client-side
(bridge-decrypt) path is possible later; v1 = plaintext replays only, say so.

---

## The "one-click" handoff — the design space (pick WITH the swuforge dev)

Three archetypes, roughly increasing in effort and in "one-click"-ness:

- **A. Export bundle (download → upload).** karabuddy generates a deck JSON
  (community-standard SWU shape); user saves it; imports into swuforge. Simplest,
  works with zero swuforge cooperation, but it's *two* clicks and needs swuforge
  to accept a file. Good fallback / v0.
- **B. Deep-link handoff.** karabuddy builds a signed/one-time-token URL to
  swuforge carrying the deck payload (or a short-lived fetch token); swuforge
  reads it on landing and saves the deck(s). True one-click; needs swuforge to
  add a landing route + agree the URL/payload contract. **Most likely the
  target** given "one-click."
- **C. Delegated pull (OAuth-ish).** karabuddy issues swuforge a scoped token to
  pull the user's decks from an export API. Most robust + reusable, most work
  (karabuddy becomes a token issuer), best if the integration grows. Probably
  over-built for v1.

The shared Discord/Google identity means B and C can both *verify same-user*
cheaply. Let the swuforge dev's ingest constraints pick between them.

**Wire format:** default to the **community-standard SWU deck JSON** (the
swudb/karabast shape: `{leader, base, deck:[{id,count}], sideboard:[{id,count}]}`,
`id = SET_NNN`) unless the dev wants otherwise — it's the lingua franca and
karabuddy already stores decks in almost exactly this shape.

---

## Open questions

### For the swuforge dev (the partnership conversation)
1. **Ingest surface:** does swuforge already accept a deck import (format? URL?
   file? endpoint?), or does that get built for this? What deck JSON shape does
   it use internally — is it the swudb/karabast `{id:'SET_NNN', count}` shape?
2. **Handoff mechanic:** can swuforge add a landing route that reads a deck from
   a URL param / short-lived token (design B)? Or is a user-uploads-a-file flow
   (design A) the realistic v1?
3. **Identity:** are they open to matching users by shared Discord/Google account
   so the migration lands in the *right* swuforge account automatically?
4. **Direction & reciprocity:** one-way (karabuddy → swuforge decks) is the ask.
   Any appetite for the reverse (swuforge deck → "record this matchup on
   karabuddy"), or cross-linking (karabuddy deck page → "open in swuforge")?
5. **Business shape of the partnership** — attribution, links, co-marketing,
   who owns the UX of the button. (Parker's call; capture what the dev wants.)

### Design decisions for Parker
6. **Which decks migrate?** Every distinct list ever recorded, or **deduped
   archetypes** (leader+base, most-recent or most-played list per archetype), or
   a **user-picks-which** selector? (Deduped-with-a-picker is the likely sweet
   spot — a user has 200 replays but ~5 decks.)
7. **Deck completeness:** the recorder's own list is a full 50 + sideboard — good.
   But mid-format/older replays may have stale lists. Representative = latest
   game of that archetype? Let the user rename/trim before sending?
8. **Consent & privacy:** exporting to a third party is a user action —
   confirm-per-migration, own-decks-only, encrypted-replays-excluded. What's the
   consent UX?
9. **Entry point:** where's the button? Deck page (`/r/[slug]/deck/[playerId]`)?
   A "My decks" surface? Settings? A dedicated `/export` page?
10. **Name it.** "Send to SWU Forge" / "Open in Forge" / "Migrate decks"?

---

## Reuse in-repo (karabuddy already does most of the deck derivation)

- **Archetype clustering + decklists from replays** already exist for the
  Sideboard Guides feature (B231, just shipped): `lib/sideboardGuides.ts`
  (`teamMatchupOptions`, `buildArchetypes`, popularity-sorted leader+base decks
  from a team's replays) and the replay **deck page**
  (`app/(app)/r/[slug]/deck/[playerId]` + `DecksTabs`) which renders a full list
  from `replays.decks`. The "a user's decks, deduped by archetype" query is a
  near-cousin of `buildArchetypes` — scoped to one user instead of a team.
- **Card/base identity:** `lib/cards.ts` (`cardIdFromSetNumber`, catalog),
  `lib/baseIdentity.ts` (functional base identity, force/splash).
- **User+token resolution:** `lib/userResolution.ts` (the export scope: userId +
  claimed tokens), the `X-Install-Token` dual-auth pattern in `/api/me/*`.
- **CORS:** `lib/cors.ts` if a browser-side cross-app call is needed.
- **Precedent for a user-data slice endpoint:** the `/api/me/*` handlers.

---

## Suggested path

1. **Talk to the swuforge dev first** — resolve the ingest-surface + handoff +
   identity questions (1–4). The answers pick design A/B/C and the wire format.
   Everything downstream depends on this; don't build ahead of it.
2. **Prototype the deck derivation locally** — "given a user, produce their
   deduped archetype decklists in the agreed JSON shape." This is pure + testable
   and reuses `buildArchetypes`; it's the part that's entirely on our side and
   de-risks the rest. (Local dev DB has a prod snapshot — real replays to derive
   from. Never run against prod; see CLAUDE.md local-dev rules.)
3. **Grill Parker on the design decisions** (6–10) — consider `/grill-with-docs`
   — then write a **BACKLOG entry** (verify the next free B-id first; **B232** as
   of 2026-07-14, but it drifts — check `BACKLOG.md` + CLAUDE.md's note).
4. **Build the smallest end-to-end slice** the dev's answers allow: one user →
   their decks → one deck landing in swuforge. Then generalize.

**Guardrails (from CLAUDE.md — they apply):** never run local dev against prod
(`.env.local` = prod creds, snapshot SOURCE only); prod is a gated deploy, not
auto; exporting user data to a third party is consent-gated and own-decks-only;
encrypted replays are excluded server-side; migrations expand/contract; adding a
CORS origin or any token-issuance is a deliberate, reviewed security change — flag
it, don't slip it in. Commit locally on-branch freely; push/PR/ship needs
Parker's go-ahead.

**Not this session's job:** karabuddy feature dev (a separate session owns that).
Stay on the partnership + migration.
