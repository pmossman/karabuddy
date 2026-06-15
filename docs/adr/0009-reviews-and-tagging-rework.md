# ADR 0009 — Team reviews + replay tagging rework

Status: **accepted** · 2026-06-14

## Context

Team review is emerging as a core karabuddy feature, but both halves of it are thin:

- **Viewer tagging** (`TagSidebar.tsx`) shows only **"This frame"** + **"Coming up."** Past tags are
  reachable only via the chevron/JumpToMenu nav — there's no "Previous" section. Tags share one
  sidebar with the karabast game log (stacked on desktop, tab-switched in a cramped ~160–380px sheet
  on mobile). The panel reads as "comments stapled to the log," not a review surface.
- **Reviews** are a *single nullable timestamp* — `replay_team_shares.reviewRequestedAt`. The owner
  requests; **any** member "marks reviewed" which **nulls the timestamp and the replay vanishes from
  the queue**. No record of who reviewed, when, or any history; the queue shows pending-only. So a
  review is consumed by the first person who clears it, the requester never learns it was done, and
  the team can't browse each other's reviews — all of which are the point.

## Decisions (confirmed with Parker)

- **Design both halves together, ship as one coordinated change** (not piecemeal).
- **A "review" is an explicit per-user mark** ("I reviewed this"), decoupled from tagging — but the
  review surface ALSO shows who left tags (reviewed vs commented are both visible).
- **Requests stay open forever** — more eyes are always welcome. Surfaces show "reviewed by N"; a
  requested replay never auto-closes or leaves the browsable list.

## Data model

Additive (expand/contract safe — [ADR 0005](./0005-safe-deploys-expand-contract.md)). Reviews are
webapp-only, so there's no extension wire-compat surface.

**New table `replay_reviews`** — one row per *(replay, team, reviewer)*; the persistent "I reviewed
this" mark (the unit that used to be a vanishing boolean):
- `id` text PK
- `replaySlug` text → `replays.slug` (cascade)
- `teamSlug` text → `teams.slug` (cascade)
- `reviewerUserId` text → `users.id`
- `reviewedAt` timestamp
- unique `(replaySlug, teamSlug, reviewerUserId)` — one mark per person per team per replay
- indexes on `teamSlug`, `replaySlug`, `reviewerUserId`

**`replay_team_shares` (extend):**
- KEEP `reviewRequestedAt` — but it now **persists** (no longer nulled on review). It's the *request*,
  not the *completion*.
- ADD `reviewRequestedBy` text → `users.id` — drives the requester's "my requests" surface.

Reviews are **per-team** (mirroring the per-team request model): a replay shared with two teams has
independent review state per team. Existing pending requests carry over unchanged; already-cleared
ones stay cleared (their history was never recorded — unrecoverable, acceptable).

**New table `replay_views`** — per-user last-viewed timestamp, for the "new tags since you last
looked" marker (cross-device, vs localStorage):
- `replaySlug` text → `replays.slug` (cascade)
- `userId` text → `users.id`
- `viewedAt` timestamp
- primary key `(replaySlug, userId)` (upsert on each viewer open)

## Lifecycle (request → reviewed-by-N, never closes)

| Action | Actor | Effect |
|---|---|---|
| **Request review** | replay owner | set `reviewRequestedAt` + `reviewRequestedBy` (persists) |
| **Cancel request** | owner | clear `reviewRequestedAt` (un-ask; distinct from "reviewed") |
| **Mark reviewed** | any member of a requested team | upsert a `replay_reviews` row for *this* user/team |
| **Unmark** | that same member | delete their row |

"Mark reviewed" is no longer a global toggle that wipes state — it's the acting member's own row.
The replay stays requested and accrues reviewer marks ("reviewed by N").

## API

- `POST /api/replays/[slug]/review` `{ teamSlug, requested }` — **owner** sets/cancels the *request*
  (existing route; now owner-only both ways, + records `reviewRequestedBy`; no longer means "done").
- **NEW** `POST /api/replays/[slug]/reviewed` `{ teamSlug, reviewed }` — the acting **member** adds/
  removes *their own* review mark. Gated to members of a team the replay is requested-for.
- `GET /api/teams/[slug]/review-queue` — returns ALL requested replays for the team (never drops
  reviewed ones), each enriched with: reviewer marks (who + when), whether the current viewer has
  reviewed, and tag/commenter summary (who left tags). Client splits **Needs review** (0 marks) vs
  **Reviewed** (≥1), plus an **Awaiting your review** personal filter (you haven't marked).
- **NEW** `GET /api/me/review-requests` — replays the current user requested, across their teams,
  with reviewer counts/marks. Drives the requester surface.
- Notify (`lib/reviewNotify.ts`): keep the request/cancel posts; ADD a "reviewed by {name}" post when
  a member marks reviewed (best-effort, env-gated, like the rest).

## Surfaces

**Team page → Reviews tab** (rework `ReviewQueue.tsx`): browsable, persistent. Sections/filter:
**Needs review** · **Reviewed** (history of everyone's reviews) · **Awaiting your review**. Each card
shows matchup, requester, reviewer avatars + count, who-commented, and a "✓ I reviewed" toggle. The
whole team browses every member's reviewed replays here — the "go through others' reviews" goal.

**Requester surface**: a "Your review requests" block (home `HomeTeamActivity` and/or
`/replays?tab=mine`) listing each request with reviewer count + avatars, so the requester sees it was
done and by whom. Plus the new notify post.

**Viewer review panel** (the reworked `TagSidebar`): a header strip showing this replay's review
status for the viewer's team(s) — reviewer avatars + a "✓ Mark reviewed" button (members only) — so a
reviewer reads the replay, leaves tags in the 3-section panel, then marks reviewed in one place. When
the replay is shared with >1 of the viewer's teams, the control is per-team (usually just one).

## Viewer panel rework (the "previous/current/upcoming" ask)

`TagSidebar` becomes a **dedicated review panel**, with the game log demoted to a secondary toggle
(segmented **Review | Log**) instead of a co-equal stacked panel — reviews are the primary use; the
log is reference. Same model on desktop and mobile, which also fixes the mobile real-estate squeeze
(one panel at full height, not two fighting for ~300px).

- **Three sections:** **Previous** (past tags, nearest-first, collapsible) → **This frame**
  (highlighted, holds the add-tag input) → **Upcoming** (nearest-first). Frame remap (orig↔collapsed)
  is unchanged; this is a filter/sort + render change.
- **Mobile:** compact one-line rows (author · snippet · frame) that expand/jump on tap; **Previous**
  collapsed by default; the review panel is the default sheet (log behind the toggle).
- **Polish hooks** (incremental, not all v1): "new since you last viewed" markers (localStorage v1),
  per-author/team filter, tag-density ticks on the scrubber.

## Migration / back-compat

- One additive migration: `replay_reviews` table + `reviewRequestedBy` column (hand-written; journal
  `when` strictly increasing). Prod migrates before the new code reads the column.
- The `review {requested:false}` semantics change (was "mark reviewed"→null; now owner-only cancel).
  Reviews are webapp-only, so no shipped extension is affected; a stale browser tab is the only
  exposure (benign).

## Build order (internal; ships as one)

1. Migration (`replay_reviews` + `reviewRequestedBy`) + `lib/schema.ts`.
2. API: request lifecycle (owner) · per-user mark · enriched queue · `me/review-requests` · notify.
3. Team Reviews tab rework (sections, avatars, browse-all).
4. Requester surface (home + `/replays?tab=mine`).
5. Viewer panel rework (3 sections, log toggle, review-status header + mark-reviewed).
6. Tests: unit (lifecycle/scope helpers), api (routes + access control + multi-reviewer), e2e
   (request → two members review → both visible, never vanishes; requester sees it).

## Resolved refinements (confirmed with Parker)

- **Requester surface** — **both**: a status block on home AND a per-row indicator in
  `/replays?tab=mine`.
- **"New since last view"** — a **`replay_views`** table (cross-device), not localStorage.
- **Mark-reviewed** — **requested-only for v1**: you can only mark a replay reviewed if it has an open
  review request for the team (keeps the queue/marks coherent).

## Consequences

- **+** Reviews become durable, multi-eyes, and discoverable by both requester and team; the core
  feature finally behaves like one.
- **+** The viewer becomes a real review surface (previous/current/upcoming + mark-reviewed in place).
- **−** Schema growth + a genuine surface rework (team tab, home, viewer). Mitigated by additive
  migration and shipping behind the existing team-membership gates.
- Tag scoping ([B71/B73](../../CLAUDE.md)) is untouched — reviews layer on top of shares, orthogonal
  to tag audience.
