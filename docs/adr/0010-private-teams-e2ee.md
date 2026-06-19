# ADR 0010 — Private teams: client-side end-to-end encryption

**Status:** Proposed (B170) · 2026-06-15 · _awaiting Parker sign-off before implementation_

## Context

Competitive teams won't prep on a third-party tool if the maintainer can read
what they're working on. Today every replay payload (full gamestates), every tag
comment, and all the derived metadata (leaders, bases, opponent usernames,
display names, labels) sit in plaintext in Postgres + Vercel Blob — readable by
anyone with DB/Blob access. **The maintainer is the threat.** That kills adoption
for the exact users (event-bound teams) the review features are built for.

We want a team to opt into a **Private (encrypted)** mode where karabuddy's
server never sees plaintext replays, comments, OR the leaders/decks being
played — while view / share / review / tag **within the team** keep working.

## The one hard constraint

The adversary is **the server operator**. The server must NEVER receive
plaintext OR the encryption key, even momentarily. This rules out "encrypt at
rest, server decrypts to compute." Only true client-side E2EE works; every
server-side feature that reads content must move client-side or turn off. Every
decision below falls out of this.

## Decisions (locked with Parker — documented, not re-litigated)

1. **Opt-in at the TEAM level.** A team has one symmetric **team key**,
   generated client-side, shared out-of-band among members. The server never
   stores or receives it — only a non-secret `team_key_id`.

2. **The extension is the sole keyholder.** The key lives only in
   `chrome.storage.local` (per team), never in the server-delivered webapp — a
   poisoned page on any deploy could otherwise grab the key and silently
   decrypt the whole DB forever. The webapp viewer/list asks the
   **content-script bridge** to decrypt; plaintext (frames/summary/comment text)
   crosses the bridge, the **key never does**. Consequence (accepted): viewing
   private replays REQUIRES the extension installed + the team key loaded — no
   pure-web link viewing.

3. **Bar = content confidentiality.** Hidden: the replay payload (gamestates),
   tag comment text, and all card/identity-revealing metadata (leaders, bases,
   opponent usernames, user-set displayName/labels). **Accepted residual leak**
   (metadata floor): the server still sees *which member uploaded an encrypted
   replay to which team, when, how many actions, how long*. Only self-hosting
   removes that floor — out of scope (**Tier 2**, noted, not built).

4. **Server extracts NOTHING for private replays.** It can't decode ciphertext,
   so the upload route skips `decodeReplay`/`extractWinners`/stats extraction
   entirely on the encrypted path. The **extension** (which already has the
   plaintext and runs the real decoder for its forward-contract self-test)
   computes a small **encrypted summary** `{ leaders, bases, usernames, winner,
   displayName, labels }` and uploads it as ciphertext. List/browse UIs decrypt
   just the summary (via the bridge) to render cards without pulling the whole
   payload.

5. **Features that turn OFF (or reroute) for private teams:** server-side stats
   aggregation (`card_events`/matchup matrix/leader stats), public sharing / OG
   unfurls / clips-as-public, server-side search/filter by leader/card (becomes
   client-side over decrypted summaries), tournament deck-URL import / swudb.
   **View / share / review / tag MUST keep working.**

6. **What stays plaintext server-side** (so reading/nav still work): replay
   `slug`, replay↔team share rows, timestamps, an `encrypted` flag +
   `team_key_id`, `actionCount`, `durationMs`, uploader identity
   (`ownerToken`/`userId`/participants). Tags keep their plaintext
   `id`/`replaySlug`/`frameIndex`/scope/timestamps/author attribution; only the
   **comment text** (and structured mentions, which name people) becomes
   ciphertext. B149 review marks (request/mark) are pure metadata — unchanged.

7. **Crypto:** WebCrypto (`AES-256-GCM` + `HKDF`), no dependency. **Envelope
   encryption from day one:** a random per-replay **data key (DK)** encrypts the
   blob + summary; the **team key (TK)** wraps the DK. Future key rotation
   re-wraps DKs instead of re-encrypting blobs.

8. **Key lifecycle realities to design for:** out-of-band sharing (a lead
   generates, members paste into the extension; "store it securely, no recovery
   if lost"); rotation is **forward-only** (a departing member keeps the old key
   — you can never retroactively un-share); **no recovery by design**.

## Team-level enforcement — "can't be used wrong" (B170, confirmed 2026-06-15)

A private team is only as private as its weakest member's habits. Without
enforcement, a member who hasn't loaded the key would record and upload
**plaintext**, sharing it to the team — exactly the leak this feature prevents.
So privacy is **enforced at the team level**, not left to the user remembering:

- **One blob, one key → arming a private team is EXCLUSIVE.** A replay is a
  single blob encrypted under a single team key, so it can't be both plaintext
  for a public team and ciphertext for a private one (nor split across two
  private teams with different keys). Arming a private team forces the whole
  replay to encrypt under that team's key and share **only** there. (A
  simplification that falls out of the architecture, not a limitation.)

- **Client (primary guarantee):** the extension already fetches team data on
  record-start, so it knows which armed teams are private + their `team_key_id`.
  If a private team is armed and its key isn't loaded, the extension
  **withholds the upload entirely, keeps the recording in local IndexedDB, and
  prompts "load your team key to record for <team>."** Nothing is lost; loading
  the key uploads it encrypted. **No plaintext ever leaves the browser.**

- **Server (defense-in-depth, metadata-only):** the upload/share path **rejects**
  any replay flagged for a private team that isn't `encrypted=true` with a
  `team_key_id` matching the team's — and rejects sharing an `encrypted` replay
  into a non-private team (they can't decrypt). This inspects only the flag +
  kid (never content, fully E2EE-compatible) and backstops a stale/buggy/old
  extension: a plaintext leak can't reach teammates or even land as a stored
  blob. Symmetrically, the team-shares endpoint enforces the same rule.

- **Scope = per-armed-team, private team armed-by-default.** The key is required
  only when the private team is armed for a given replay. The private team is in
  the member's default armed set, so in practice their normal uploads are
  key-gated — but a member can still explicitly record a casual/public game
  unencrypted. (Not a member-global lock that would trap casual play.)

- **No-key UX:** a private-team member who records without the key sees a clear
  in-bubble prompt; the recording sits in local IndexedDB and uploads once the
  key is loaded. Auto-upload pauses, the game is never lost.

This turns private mode from "a feature you must use correctly" into "a feature
that can't silently leak." Phases 2–3 implement both the client withhold and the
server rejection.

## Rollout, capability gating & hand-holding (confirmed 2026-06-17)

Private teams depend on the extension version, so the feature must never let a
team into a half-broken state (owner flips it on; members on old extensions
silently stop reaching the team). The guardrails make the dependency visible and
self-correcting, and the UX leans into hand-holding.

- **Capability handshake (feature detection, not version math).** The
  karabuddy-origin bridge (the same channel Phase 4 decrypt uses) answers
  `getCompanionInfo() → { installed, version, capabilities }`. The extension
  advertises `'privateTeams'` ONLY in builds that implement it; the webapp
  feature-detects. Three inferred states: no response within ~1s → not installed;
  responds without the capability → too old; has the capability → supported. The
  version string is shown for display only. (Robust to the pmossman fork / patch
  bumps, unlike a version-number compare.)

- **Enable-time gate (owner, Phase 5).** The team "Private mode" toggle is
  capability-gated on the owner's own extension: disabled with an auto-detected,
  re-checkable "update the extension" CTA + store link until supported. On enable
  → a guided wizard: generate key → copy/share-securely ("store it; no recovery")
  → "teammates must update + paste this key."

- **View-time gate (members, Phase 4).** A private replay renders a TIERED gate,
  each state with one clear next action: install extension → update extension →
  load your team key → ✅ decrypt & render. No dead ends.

- **Owner readiness roster (the magic, Phase 5).** The extension pings a small
  authenticated readiness endpoint (`POST /api/me/extension/readiness`) with its
  `capabilities` + the `team_key_id`s it has loaded (NOT the keys). The server
  maps loaded kids → teams and shows the owner a per-member roster: *✅ ready ·
  ⚠️ needs update · 🔑 needs key · 🕐 not seen*. Turns a scary rollout into a
  visible checklist the owner can nudge against.

- **Broad nudge.** Reuse the existing kill-switch **nag** (`KARABUDDY_EXT_LATEST`,
  ADR 0004) so every member gets a generic "update available" prompt when the
  private-teams version ships — no new mechanism.

- **Existing plaintext replays stay plaintext.** Enabling private mode does NOT
  retroactively encrypt already-shared replays (the server already has them). The
  UI states it plainly: "Existing shared replays stay as they are; only new
  replays will be private." (Confirmed over auto-un-sharing them.)

## Crypto design (the trusted artifact)

A single isolated module `lib/e2ee.ts` (+ a byte-identical extension copy at
`extension/replays/00-e2ee.js`, parity-tested exactly like `commentScope.js` /
`karabastShape.js`) is the **entire** trusted surface. It exports only:

- `generateTeamKey() → { key, teamKeyId }` — 256-bit random TK + its derived id.
- `teamKeyId(TK) → string` — `base64url(HKDF-SHA256(TK, info="kb-team-key-id", 8 bytes))`.
  Non-invertible + deterministic, so every member who pastes the same key
  computes the same id; reveals nothing about the key.
- `encryptContent(TK, plaintextBytes) → envelope` — generate random DK, AES-GCM
  encrypt the content under DK (random 96-bit nonce), AES-GCM wrap DK under TK
  (separate nonce). Returns `{ v, alg, kid, wrappedKey, nonce, ct }` (all
  base64url; `kid` = `teamKeyId(TK)`).
- `decryptContent(TK, envelope) → plaintextBytes` — unwrap DK with TK, decrypt
  ct. Throws on `kid` mismatch / auth-tag failure (wrong or rotated key).
- `rewrapKey(oldTK, newTK, envelope) → envelope` — unwrap DK with old TK,
  re-wrap under new TK; ct/nonce untouched (rotation without re-encrypting blobs).

Envelope wire shape (versioned, `v:1`) is the additive contract; the server
treats it as an opaque string and never parses it. Encoding is JSON→bytes for
the summary/comment, raw payload JSON→bytes for the blob.

**Key-leak audit (the value prop lives here)** — every outbound path must be
proven key-free:
- Upload route (`POST /api/replays`) — body carries ciphertext + envelopes +
  `encrypted` flag + `teamKeyId` only.
- Tag write — ciphertext comment only.
- B80 drift beacon (`POST /api/extension/health`) — already content-free
  (enum-filtered); re-audit it sends nothing new.
- Any health/telemetry / clientMeta — re-audit; no key, no plaintext.
- The bridge returns **plaintext out**, never the key; the SW reads the key
  from `chrome.storage.local` and it never leaves the extension origin.

## Bridge plumbing (net-new — does not exist today)

The karabast.net side has a generic `companionRequest`→SW relay (content.js +
`01-namespace.js`). The **karabuddy-origin** side (`karabuddy-bridge.js`) today
only does install-token/claim via `postMessage` — there is **no** generic
SW relay there. Private-team viewing needs one. We add a minimal, explicit
`postMessage` request/response channel on the karabuddy origin:

- page → bridge: `{ type: 'kb:decrypt', kind: 'summary'|'blob'|'comment', teamKeyId, envelope }`
- bridge → SW (`chrome.runtime.sendMessage`) → SW loads TK for `teamKeyId` from
  `chrome.storage.local`, calls `decryptContent`, returns **plaintext**.
- bridge → page: `{ type: 'kb:decryptResult', requestId, ok, plaintext }`.
- Symmetric `kb:encrypt` for **authoring** tags on a private replay from the web
  (page sends plaintext comment → SW encrypts under TK → returns envelope →
  page POSTs the envelope). Keeps the key out of the page on the write path too.
- Plus key-management messages handled entirely in the extension UI (not the
  page): `storePrivateTeamKey` / `listPrivateTeamKeyIds` / `forgetPrivateTeamKey`.

The bridge speaks only to same-origin karabuddy pages (manifest match), exactly
like the existing claim bridge.

## Threat model (honest)

**Defeated:** a server operator (or anyone with DB/Blob/log access) reading
replay contents, comments, or leaders/decks. Ciphertext + envelopes are all they
get; the team key is never on the server.

**Residual / accepted:**
- **Metadata floor** (decision 3): who-uploaded-what-to-which-team-when + action
  count + duration, plus an opaque per-match `gameId` the extension sends in the
  clear so periodic snapshots overwrite one row (it reveals no card/deck/identity
  content — just "this is match X"). Plus, for the readiness roster, a non-secret
  per-member "has team X's key loaded" boolean + the extension's `capabilities`
  (NOT the key) — readiness metadata for a feature the user opted into; the
  adversary already knows team membership. Self-host only (Tier 2). Documented in
  `/privacy`.
- **Poisoned-page plaintext exfiltration (the sharp one):** keeping the key out
  of the page (decision 2) prevents *permanent, offline, silent, all-members*
  compromise — a leaked key would decrypt the entire DB forever. But a malicious
  webapp build served to a victim who has the extension + key loaded can ask the
  bridge to decrypt ciphertext that victim can access and exfiltrate the
  **plaintext**. That leak is **online, per-victim, observable as network
  traffic, and bounded to what that victim could already see** — strictly weaker
  than a key leak, but non-zero. We do NOT claim to defend a user against a
  malicious karabuddy deploy targeting them specifically while they browse
  private replays. Documented in the verification guide; the mitigation lever
  (user-gesture-gated decrypt) is noted as a future option, not v1.
- **No recovery / forward-only rotation** (decision 8): lost key = lost access;
  a departing member keeps old ciphertext they already could read.
- **Trust-on-first-use of the build:** mitigated by reproducible builds (below),
  not eliminated (CWS auto-update still requires trusting a future version —
  noted).

## Reproducible builds (the trust story)

The pitch is "read the one buildless crypto module + verify the published CWS
zip matches the tagged GitHub source." Buildless plain JS makes this tractable:
the zip is `package-extension.sh` output with no transpile step. We make the zip
**byte-reproducible from a tag** (pin file order / mtimes / zip metadata in
`package-extension.sh`) and ship `docs/e2ee-verification.md`: how to rebuild from
the tag, diff against the CWS zip, and audit the ~1-file crypto surface.

## Data model (additive — expand/contract, ADR 0005)

All additive; the `encrypted` flag is the seam. The server NEVER stores the team
key — only the non-secret `team_key_id`.

- `teams`: `private_mode boolean not null default false`, `team_key_id text`
  (the active key's id; null until private mode is enabled). **Never** the key.
- `replays`: `encrypted boolean not null default false`, `team_key_id text`,
  `encrypted_summary text` (the summary envelope), `encrypted_blob` semantics —
  the existing `payloadBlobUrl` blob simply holds the envelope ciphertext for
  encrypted replays (no new column). On encrypted rows `players` is stored as
  `[]` (it's NOT NULL) and `match`/`decks`/`winners`/`displayName`/`labels` stay
  NULL — the server never derives or holds plaintext identity/deck data.
- `tags`: `comment_encrypted text` (envelope); `comment` stays `''` for
  encrypted tags. `mentions` null (names leak people) — mentions on private
  replays are deferred / client-only (open question below).
- No new key table. `team_key_id` is the only key-related thing persisted, and
  it's non-secret by construction.

Migration: one additive migration, hand-written, journal `when` strictly
increasing (CLAUDE.md). Old server ignores the new columns; old extension never
sets `encrypted`, so the plaintext path is untouched (two-sided compat).

## Build phases (TDD per layer; verify with Parker before shipping)

0. **Crypto module** (`lib/e2ee.ts` + parity'd extension copy + parity test) —
   envelope encrypt/decrypt, key wrap/unwrap, kid derivation, nonce handling.
   THE trusted artifact; build + audit this first, in isolation.
1. **Schema/migration** — the additive columns above + `lib/schema.ts`.
2. **Extension** — per-team key storage UI in the bubble; refresh teams'
   private-mode + `team_key_id` on record-start; compute + upload the encrypted
   summary + envelope blob on the encrypted path; **withhold + keep-local +
   prompt when a private team is armed without its key** (the client enforcement
   above); the karabuddy-origin bridge decrypt/encrypt channel + SW handlers.
3. **Server** — accept encrypted uploads (store ciphertext + summary + flag +
   kid, skip decode/extract/stats); accept ciphertext tag comments; serve them.
   **Enforce the team-level rule (metadata-only): reject a non-encrypted upload/
   share flagged for a private team, and reject sharing an encrypted replay into
   a non-private team** (upload route + team-shares endpoint). Old server ignores
   the new fields gracefully.
4. **Webapp** — the karabuddy-origin bridge channel (`getCompanionInfo` capability
   handshake + decrypt/encrypt); bridge-decrypt in the viewer + replay list; the
   TIERED view gate (install → update → load key → render); disable
   stats / public / search for private teams.
5. **Team UI + rollout** — capability-gated "Private mode" toggle + key generate /
   paste / rotate UX ("store securely, no recovery"); the readiness roster
   (`POST /api/me/extension/readiness` ping → per-member ready / needs-update /
   needs-key); "existing replays stay plaintext" messaging; kill-switch nag bump.
6. **Docs + demo** — this ADR (finalized), the honest threat model,
   `docs/e2ee-verification.md` (reproducible-build + audit guide), and a
   `demo:private` seed (private team + pre-encrypted replay under a fixed test
   key) for local end-to-end verification.

## Local testing

The guarantee is layered; the lower layers are trivially testable, only the full
browser path has friction (and a clean recipe):

- **Crypto + schema/server** (Phases 0–1): pure unit + pglite api tests — fast,
  no browser. Done.
- **Encryption-on-upload** (Phases 2–3): a test drives the **real recorder →
  encrypt → server-store → keyholder-decrypt** roundtrip from a fixture
  (extending the forward-contract harness), plus an explicit assertion that a
  **non-encrypted upload is byte-for-byte the old path**. The **backward-contract**
  test (frozen 0.5.0 wire → current server) stays green = old extensions
  unaffected. So "non-private unaffected" + "private produces ciphertext" are
  both proven without playing a live game.
- **Full browser end-to-end** (Phase 4): the bridge content script only matches
  `localhost:3000` (deliberate — CLAUDE.md), while dev normally runs on `:3001`.
  Recipe: a **throwaway Chrome profile** + run dev on `:3000` + set the
  extension's `karabuddyEndpoint` to `http://localhost:3000` + load the team key
  → record on karabast → uploads encrypted to local → view locally with the
  bridge live. The :3001 warning is about not doing this with *real* games; a
  dedicated profile is the intended escape hatch.
- **`demo:private` seed** (mirrors `demo:double-sided`): seeds a private team + a
  pre-encrypted replay under a fixed test key, so you paste that key into the
  extension and see a private replay render in ~30s — and confirm a non-keyholder
  / no-extension visitor gets the gate. The "see it work locally" path.
- **No dev-only "paste key into the page" shortcut** — it'd violate the
  key-never-in-page rule and risk shipping. The :3000 profile keeps the real
  architecture in the loop.

## Resolved refinements (confirmed with Parker, 2026-06-15)

- **Mentions on private replays — DROP for v1.** `mentions` is null on encrypted
  tags; no @-mention/notification (inbox or Discord) on private replays. The
  server-side inbox stays plaintext-only. Documented as a v1 limitation; a
  client-side notification story is future work.
- **Comment data key — REUSE the replay's DK.** A private replay's tags are
  encrypted under the same DK as the replay (same audience), so there's one
  decrypt context per replay and fewer wrapped keys.
- **`team_key_id` — deterministic HKDF from the key:**
  `base64url(HKDF-SHA256(TK, info="kb-team-key-id", 8 bytes))`. Every member who
  pastes the same key converges on the same id with no coordination;
  non-invertible, reveals nothing about the key.
- **Rotation — forward-only + manual** (locked decision 8 confirmed): the lead
  rotates the key and re-shares out-of-band; a departing member keeps the old
  key and any ciphertext they already could read. No retroactive un-share.

## Explicit key rotation with re-wrap (built 2026-06-18, confirmed full-rewrap scope)

When a key may have leaked or a member leaves, an owner can rotate to a new key
**and re-secure existing replays** under it — so the old key stops opening the
team's server-stored library. This is the "full rewrap of existing replays"
scope Parker chose (vs. a lighter forward-only-for-new-uploads variant, which
would leave history readable by the old key).

Envelope encryption makes it cheap: we **re-wrap each replay's data key**
old→new (`lib/e2ee.rewrapKey`), never re-encrypting the (large) content
ciphertext — only the wrapped DK + `kid` change.

Flow (owner, both old + new keys loaded in the extension):
1. `GET /api/teams/[slug]/rotation-manifest` (owner-only) → every encrypted
   replay under the team's current key + the blob URL, encrypted summary, and
   encrypted tag-comment ciphertext (all opaque). Re-fetchable → resumable.
2. For each: the owner's browser fetches the blob, asks the extension to
   `rewrapForTeam(oldKid, newKid, envelope)` for the payload, summary, and each
   tag (the SW holds both keys; the page only ever handles ciphertext), then
   `POST /api/replays/[slug]/rewrap` with the re-wrapped envelopes.
   - The rewrap endpoint validates each envelope advertises `kid === newKid`
     (can't decrypt — the GCM tag is the real gate on the client), re-PUTs the
     blob, and flips `replays.team_key_id` to the new kid. Authorized to **team
     owners** of a private team the replay is shared with (re-wrap discloses
     nothing new — an owner already holds the team key).
3. `PATCH /api/teams/[slug] { rotateTeamKeyId }` flips the **team** to the new
   kid — but only after a **completeness check**: it refuses (409) if any
   encrypted replay shared with the team is still under a different kid, so the
   team key and its replays can never drift apart. Resumable: re-run picks up
   whatever's left, then the flip succeeds.

**The honest caveat (surfaced in the UI + on `/how-privacy-mode-works`):**
rotation is forward-only. It re-secures what's *on the server*; it cannot claw
back data anyone already downloaded with the old key. It deprecates a leaked key
for ongoing server-side access, not retroactively.

Known limitation: a replay shared with two teams that (pathologically) use the
*same* key id would be re-wrapped to one team's new key, leaving the other's flip
to fail its completeness check until that team rotates too — surfaced as an
error, never silent corruption. Teams should not share a key across teams.

## v1 limitations (noted, acceptable)

- **No double-sided / deck-enrich for encrypted replays.** The teammate-alt and
  deck-merge paths (B82/B112) need to read plaintext, which the server can't do
  for ciphertext. A teammate co-recording a private game produces their own
  separate encrypted row; no merged complete-information view. Future work.
- **In-game tags ride inside the encrypted payload.** The server can't lift
  payload-embedded tags into the relational `tags` table for an encrypted upload
  (they're ciphertext), so the discussion feed for a private replay is built from
  web-authored encrypted tags (`comment_encrypted`) plus whatever the viewer
  surfaces from the decrypted payload (Phase 4). No server-side scoping of
  in-game private tags.
- **Private replays can't be made public.** The public/OG path is disabled for
  private teams (decision 5); `public_at` must never be set on an encrypted row
  (enforced where the toggle lives, Phase 4/5).

## Consequences

- **+** A real privacy guarantee against the maintainer — the unlock for
  competitive-team adoption.
- **+** Crypto is a tiny, isolated, separately-auditable module; the plaintext
  path is structurally untouched (the `encrypted` flag seam).
- **−** Private replays can't be viewed without the extension + key; several
  server-side features go dark for private teams; no recovery on key loss.
- **−** Honest residual leaks (metadata floor, poisoned-page plaintext) that we
  document rather than hide — the trust story depends on stating them plainly.
