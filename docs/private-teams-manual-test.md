# Private teams (B170) — manual E2E test checklist

The buildless extension UI (bubble, key manager) has no automated coverage, so
run this once on **fresh local state** before publishing. Tests are auto-covered
for crypto, the encrypted upload + share enforcement, the rotation endpoints, and
the bridge client — this checklist is the human pass over the surfaces those
can't reach.

## Setup

```sh
npm run db:dev:up
npm run demo:private:seed        # seeds 2 private teams + 1 open team + a demo encrypted replay
KARABUDDY_TEST_API=1 next dev -p 3000   # (or your usual dev server on :3000)
```

- Load `extension/` unpacked at `chrome://extensions` (Developer mode → Load unpacked); **reload it** after any extension edit.
- On a karabast.net tab DevTools console: `chrome.storage.local.set({ karabuddyEndpoint: 'http://localhost:3000' })`.
- Sign in at `http://localhost:3000` (so the install token links to your account; the seed puts every local user on both teams).

Demo keys (printed by the seed):

```
demoDEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMOdem   ← Demo Private Team
kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy   ← Demo Private Team B
```

## 1 · Non-keyholder baseline (before loading any key)

- [ ] Open `/r/r_privdemo` with the extension installed but the key **not** loaded → the **private-replay gate** shows `🔑 Load your team key` + "Open key manager" + "How private mode works →".
- [ ] With **no** extension → gate shows "Install the extension"; with an **old** build → "Update needed".
- [ ] The team dashboard for Demo Private Team shows the **member readiness banner** (amber) until you're set up.

## 2 · Member loads the key

- [ ] Open the key manager (gate's "Open key manager", or team Settings → "Manage this team's key", or the bubble's "Manage private team keys").
- [ ] Master list shows Demo Private Team as **🔑 Needs key** → click in → paste the key → row flips to **✓ Active key loaded**.
- [ ] Back on `/r/r_privdemo` → **Re-check** → the board + matchup cards + the seeded comment decrypt and render.
- [ ] Wrong key paste → rejected ("doesn't match the public fingerprint").

## 3 · Record encrypted (the happy path)

- [ ] In the bubble's **Share with teams**, arm **Demo Private Team** (key loaded) → header chip shows **🔒 N**, row shows **🔒 Encrypted**.
- [ ] Start a match on karabast.net → header shows **REC** + **🔒**. Finish/let it upload → it uploads **encrypted**.
- [ ] In the DB, the row is private-safe: `select encrypted, team_key_id, players, match, winners, encrypted_summary from replays where slug=...;` → `encrypted=t`, `players={}`, `match/winners` null, `encrypted_summary` present (and contains no plaintext usernames). The blob is ciphertext.

## 4 · Withhold (no key) + recover

- [ ] **Forget** the key (key manager) and re-arm Demo Private Team → bubble row goes **amber** with `(!)` LED + **⚠ won't upload**; header chip **⚠ N**.
- [ ] Record a match → it is **withheld** (nothing uploads); toast points to the bubble.
- [ ] Re-load the key → open the bubble idle panel → **Not yet uploaded** lists the game → **Upload** → uploads encrypted. (Safe: plaintext never reached the server.)

## 5 · Arming guardrails

- [ ] With Demo Private Team armed, **Demo Open Team** and **Demo Private Team B** are **disabled** (greyed) — hover shows why. Un-arm to switch.
- [ ] On a **plaintext** replay's Share popover (`/r/r_opendemo`), the private team toggle is **disabled** with "This replay was uploaded without encryption…".

## 6 · Rotation (entirely in the key manager)

- [ ] Key manager → Demo Private Team → **Rotate key** → a new key appears under "🔄 New key — rotating in" with **Show new key** (copy it).
- [ ] **Run rotation** → progress → completes. The team's active key is now the new one; the old key appears under **Previous keys — inactive · safe to delete** (Show key works, Delete works).
- [ ] `/r/r_privdemo` still decrypts (re-encrypted under the new key). The old key alone no longer opens it.

### 6a · Member side of rotation — pre-load the new key (zero-downtime, **two profiles**)

The safe order is: owner generates → shares the new key → **member stages it** → owner runs rotation.

- [ ] **Member profile**, key manager → Demo Private Team detail (current key loaded → "✓ Active key loaded"). Under **Upcoming key**, the quiet toggle **"＋ Got a new key from your team owner?"** expands a paste box.
- [ ] Paste the new key the owner shared → **Add new key**. It flips to **"✓ New key added — it takes over automatically…"** with Show / Remove; the team's master row now reads **"🔄 Rotation in progress"**.
- [ ] Pasting the team's *current* key here is rejected ("that's …'s current key — you already have it loaded"); a malformed paste is rejected too.
- [ ] **Owner profile** runs the rotation (step 6). Back on the **member profile**, reopen the key manager → the staged key is now the **active** key ("✓ Active key loaded"), the "Upcoming"/"in progress" markers are gone, and the old key sits under **Previous keys**. `/r/r_privdemo` decrypts the whole time — no lockout window.

## 7 · Off-for-private + discoverability

- [ ] Team page **Stats** tab for a private team → "Stats are off for private teams".
- [ ] Private replays can't be made public (no public toggle / `public_at` never set).
- [ ] "How private mode works" reachable from: team Settings privacy header (→ #for-owners), the member banner + viewer gate (→ #for-members), the key-manager footer.
- [ ] karabuddy.app tab shows the KaraBuddy favicon (not the globe).

## Owner ↔ member, multi-device note

The strongest test uses **two browser profiles** (owner + a second member) so you
exercise the real out-of-band key handoff and the readiness roster reflecting a
second member. A single profile validates everything except that hand-off.
