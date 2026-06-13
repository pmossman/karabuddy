import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  bigserial,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  boolean,
} from 'drizzle-orm/pg-core';
import type { AdapterAccountType } from 'next-auth/adapters';

// ----- Auth.js standard tables (users / accounts / sessions / verificationTokens)
//
// Following the Auth.js Drizzle adapter spec exactly so the off-the-shelf
// adapter just works. User IDs are opaque UUIDs (NOT derived from provider
// IDs) so the same karabuddy account can later link multiple providers
// without re-keying. When karabast exposes OAuth (path 2), it becomes a
// new row in `accounts` for existing users — no data migration.
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  // B84: karabastUsername removed — the extension's install-token→account link
  // is the only bridge; karabast username is never required. Attribution +
  // intra-team detection are account-based (see replay_participants).
  // B75: per-user extension settings, synced across devices via /api/me/settings.
  // defaultShareTeamSlugs = the bubble's persistent "armed teams" set (which
  // teams a recorded replay auto-shares into). minUploadActions = the minimum
  // number of actions EACH player must take before a replay is worth uploading
  // (gates the recorder's auto/periodic/pagehide uploads; manual is exempt).
  defaultShareTeamSlugs: jsonb('default_share_team_slugs').$type<string[]>(),
  minUploadActions: integer('min_upload_actions').notNull().default(5),
  // B81: global Discord-notifications kill switch. The user's Discord ID isn't
  // stored here — it's already in accounts.providerAccountId (provider=discord)
  // from sign-in, so notifyMentions reads it from there.
  // Discord DMs are STRICTLY OPT-IN (B99): this defaults to true (disabled), so
  // no one is DM'd until they explicitly enable "Send me Discord notifications".
  // It's the master gate over both direct + team mentions in notifyMentions.
  notificationsDisabled: boolean('notifications_disabled').notNull().default(true),
  // B101: opt OUT of the GLOBAL stats corpus (ADR 0007). Default included
  // (opt-out model); the global aggregates are anonymized + min-N gated, and
  // personal/team scopes ignore this flag entirely. Toggle on /settings.
  excludeFromGlobalStats: boolean('exclude_from_global_stats').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
    userIdx: index('accounts_user_idx').on(account.userId),
  })
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

export type User = typeof users.$inferSelect;

// Extension install tokens linked to a user account. When an extension
// upload's installToken is found here, we attribute the upload to that
// user automatically (prospective). The same row drives the retroactive
// claim flow: linking a token also backfills userId on existing replays
// + tags that share the token. One extension install ↔ one user.
export const extensionTokens = pgTable('extension_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
});

// Replays — one row per uploaded .karareplay payload. The payload itself
// lives in Vercel Blob (payloadBlobUrl); this row is the metadata index.
//
// `slug` is the short id used in the share URL (karabuddy.com/r/<slug>).
// `gameId` is karabast's gameState.id — used to dedupe re-uploads of the
// same match.
// `ownerToken` is the opaque installToken from the uploader's extension /
// browser. No auth yet; this is how we attribute uploads and gate
// (later) "your library" listings without forcing sign-in.
export const replays = pgTable(
  'replays',
  {
    slug: text('slug').primaryKey(),
    gameId: text('game_id').notNull(),
    // Authenticated uploads attribute to userId. Anonymous uploads (extension
    // without a linked session, or web visitors not signed in) keep ownerToken.
    // A row may have one or both: a logged-in upload sets userId AND keeps the
    // installToken for backward-compat / "claim my anon uploads" flows.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    ownerToken: text('owner_token').notNull(),
    players: jsonb('players').notNull(), // [{username, leader: {name, set, number}, base: {...}}]
    durationMs: integer('duration_ms').notNull().default(0),
    actionCount: integer('action_count').notNull().default(0),
    payloadBlobUrl: text('payload_blob_url').notNull(),
    payloadSizeBytes: integer('payload_size_bytes').notNull().default(0),
    // B42: match metadata (format, cardPool, bo3 mode, etc.) + per-user
    // deck snapshots (leader/base for both players; full deck + sideboard
    // for the local player only — karabast masks opponent's full list).
    // Both null on historical replays uploaded before B42 + on any future
    // upload where the extension didn't catch a lobbystate first.
    match: jsonb('match'),
    decks: jsonb('decks'),
    // B59: winners extracted from the final gamestate at upload (and
    // re-extracted on snapshot upserts). Array of playerIds from the
    // payload's `players` map. Null on:
    //   - replays uploaded before B59
    //   - games that ended via disconnect / abandon (no winner signal)
    //   - draws (rare in SWU; if karabast does emit a draw signal, the
    //     extractor would store an empty [] instead of null).
    winners: jsonb('winners'),
    // B59-followup: the recorder's local-player id from the payload
    // (B33 POV detection). Lets the Result filter on /replays?tab=mine
    // ask "did the owner win this match?" without a karabast-username
    // lookup. Set ONCE on first insert; later uploads don't overwrite.
    ownerPlayerId: text('owner_player_id'),
    // B53: user-editable display name. Null falls back to the auto-matchup
    // text the viewer / card teaser composes from the players array.
    displayName: text('display_name'),
    // B53: free-form labels for filter/find later. Distinct from frame
    // tags (those live in the `tags` table and anchor to specific frames);
    // these tag the whole replay. Stored as text[]; client trims, dedupes,
    // and caps server-side.
    labels: jsonb('labels'),
    // B114: recorder/client metadata attached by the EXTENSION'S service worker
    // at upload time (the SW can read chrome.runtime.getManifest(); the MAIN-world
    // recorder can't). A small bag — { extVersion, extVersionName, browser, os,
    // ua } — so we can see which extension version produced a replay without
    // asking the user (diagnosing recorder regressions, e.g. Bo3 capture gaps).
    // Latest upload for a slug wins. Null on web uploads + pre-B114 extensions.
    clientMeta: jsonb('client_meta'),
    // B133: owner-controlled public sharing. (B85 removed the old always-on
    // "visibility" concept; this is the deliberate per-replay opt-in.) NULL =
    // unlisted (link-accessible + team shares only — the default). Set = the
    // owner made it public: it appears in the public browser and ALL its tag
    // comments become visible to non-entitled viewers in REDACTED form
    // (aliased authors, mentions stripped — lib/publicTags.ts).
    publicAt: timestamp('public_at'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    gameIdIdx: uniqueIndex('replays_game_id_idx').on(t.gameId),
    ownerIdx: index('replays_owner_idx').on(t.ownerToken),
    userIdx: index('replays_user_idx').on(t.userId),
    createdAtIdx: index('replays_created_at_idx').on(t.createdAt),
  })
);

// Tags — anchored to a frame in a replay. Same model as the extension's
// in-payload tags, but stored relationally so they're queryable +
// independently mutable without rewriting the whole payload blob.
//
// `authorToken` is the installToken of whoever added the tag. `authorName`
// is whatever display name was used at create time (real karabast username
// or anon-XXXX fallback). They diverge: a user could rename themselves
// later without rewriting historical tags.
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    replaySlug: text('replay_slug')
      .notNull()
      .references(() => replays.slug, { onDelete: 'cascade' }),
    frameIndex: integer('frame_index').notNull(),
    // Same dual-attribution as replays — userId for authenticated, token for
    // anonymous. authorName is the display string (karabast username, OAuth
    // display name, or anon-XXXX) — kept on the row so renames don't rewrite
    // history.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    authorToken: text('author_token').notNull(),
    authorName: text('author_name').notNull(),
    comment: text('comment').notNull().default(''),
    // B55c: structured mention targets parsed out of the comment text at
    // tag-write time. Shape: `{ userIds: string[], teamSlugs: string[] }`.
    // The comment text itself still contains the bare `@handle` for
    // display; this column is authoritative for queries (mentions inbox,
    // notifications). Null on tags created before B55c.
    mentions: jsonb('mentions'),
    // B78: one-level reply threading (Google-Docs-style). A reply is a tag
    // whose parentTagId points at a top-level tag; it inherits the parent's
    // frame + team scope and auto-@mentions the parent author. Replies can't
    // themselves be replied to (one level only — enforced in the POST route).
    // FK + index in migration 0012.
    parentTagId: text('parent_tag_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    replayIdx: index('tags_replay_idx').on(t.replaySlug),
    authorIdx: index('tags_author_idx').on(t.authorToken),
    userIdx: index('tags_user_idx').on(t.userId),
    parentIdx: index('tags_parent_idx').on(t.parentTagId),
  })
);

export type Replay = typeof replays.$inferSelect;
export type NewReplay = typeof replays.$inferInsert;

// ----- B55a: Teams + membership + invites
//
// A team is a group of karabuddy users. Anyone can create a team and get
// a fresh slug. The creator is an owner; they can promote other members
// to owner. Membership is recorded in `team_members`; invites are short
// random codes that grant membership on visit.
//
// Slugs are short (~6 chars, generated via generateTeamSlug in lib/slug)
// so `/teams/xyz123` is shareable as a URL. `name` is the display string
// and can change without breaking the slug.
export const teams = pgTable('teams', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'set null' as any }),
  // B81: when the KaraBuddy bot is invited to a team's own Discord server, the
  // owner picks a channel; team activity (new shares, mentions) posts there via
  // the bot token. Null = no Discord posting configured for this team.
  discordGuildId: text('discord_guild_id'),
  discordChannelId: text('discord_channel_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// B81: per-(team, member) Discord DM preferences. Defaults ON — a member opts
// out of direct or team-mention DMs for a specific team. The global kill switch
// (users.notificationsDisabled) overrides these.
export const teamMemberPrefs = pgTable(
  'team_member_prefs',
  {
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Strictly opt-in (B99): default false. A member gets team-mention DMs only
    // if a row here explicitly sets the flag true (and the global switch is on).
    dmOnDirectMention: boolean('dm_on_direct_mention').notNull().default(false),
    dmOnTeamMention: boolean('dm_on_team_mention').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamSlug, t.userId] }),
  })
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'owner' can rename the team, generate invites, kick members, delete
    // the team. 'member' can only view + leave. Every team must have at
    // least one owner; the creator starts as one.
    role: text('role').notNull().default('member'), // 'owner' | 'member'
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamSlug, t.userId] }),
    userIdx: index('team_members_user_idx').on(t.userId),
    teamIdx: index('team_members_team_idx').on(t.teamSlug),
  })
);

// Invite codes for joining a team. Reusable by default — `expiresAt` and
// `usesRemaining` are both nullable for the "never expires, unlimited"
// case. When usesRemaining hits 0, the code stops working but the row
// stays (revocable record).
export const teamInvites = pgTable(
  'team_invites',
  {
    code: text('code').primaryKey(),
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' as any }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    usesRemaining: integer('uses_remaining'),
  },
  (t) => ({
    teamIdx: index('team_invites_team_idx').on(t.teamSlug),
  })
);

export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamInvite = typeof teamInvites.$inferSelect;

// B55b: explicit "share this replay with team X" link. A replay surfaces
// in a team's view via two signals:
//   1. ANY team member has tagged the replay (implicit — no row in this
//      table; the team-grid query joins tags + team_members instead).
//   2. The replay's owner explicitly added this row (this table).
// Signal #2 covers the "I want my teammates to see this match even
// though nobody's tagged it yet" case. Set + unset by the replay owner
// from the viewer's Share popover.
export const replayTeamShares = pgTable(
  'replay_team_shares',
  {
    replaySlug: text('replay_slug')
      .notNull()
      .references(() => replays.slug, { onDelete: 'cascade' }),
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
    sharedBy: text('shared_by')
      .notNull()
      .references(() => users.id, { onDelete: 'set null' as any }),
    sharedAt: timestamp('shared_at', { withTimezone: true }).notNull().defaultNow(),
    // B135: the uploader flagged this replay for review by this team. Null =
    // not requested; a timestamp = requested at. Anyone on the team clears it
    // (mark reviewed) → null. Drives the team's Review-queue tab.
    reviewRequestedAt: timestamp('review_requested_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.replaySlug, t.teamSlug] }),
    teamIdx: index('replay_team_shares_team_idx').on(t.teamSlug),
    replayIdx: index('replay_team_shares_replay_idx').on(t.replaySlug),
  })
);

export type ReplayTeamShare = typeof replayTeamShares.$inferSelect;

// B136: replay clips — a saved [start,end] frame range of a replay with its own
// shareable slug (the dedicated reel viewer at /c/<slug>). Frames are stored in
// ORIGINAL space (like tags) so they survive a re-upload's re-collapse. Any
// viewer can create one (dual userId/createdBy attribution, like tags); the
// creator OR the replay owner can delete it.
export const clips = pgTable(
  'clips',
  {
    slug: text('slug').primaryKey(),
    replaySlug: text('replay_slug')
      .notNull()
      .references(() => replays.slug, { onDelete: 'cascade' }),
    startFrame: integer('start_frame').notNull(),
    endFrame: integer('end_frame').notNull(),
    title: text('title'),
    // Signed-in creator (set-null on account delete) + the token that owns the
    // clip for the mutate check (session userId or install token).
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    replayIdx: index('clips_replay_idx').on(t.replaySlug),
    creatorIdx: index('clips_creator_idx').on(t.createdBy),
  })
);

export type ClipRow = typeof clips.$inferSelect;

// B84: who RECORDED a replay, by karabuddy account. Account-based bridge —
// when a linked install uploads, its user becomes a participant; when two
// teammates both record the same match, both are participants. Drives
// intra-team match detection (≥2 participants are teammates) and "shows in
// both their libraries", with zero dependence on karabast usernames.
export const replayParticipants = pgTable(
  'replay_participants',
  {
    replaySlug: text('replay_slug')
      .notNull()
      .references(() => replays.slug, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.replaySlug, t.userId] }),
    userIdx: index('replay_participants_user_idx').on(t.userId),
  })
);

// B112: double-sided replays. When two teammates both record the same match,
// the FIRST upload is canonical (its frames live in the public blob); the
// SECOND recording — the OTHER player's perspective, with THEIR hand unmasked —
// is kept here so the viewer can flip between perspectives. Stored in a side
// table (not on `replays`) so the ≤8MB `payload` never rides along on the broad
// `select()`s the replay lists do. PRIVATE: this row reveals a hidden hand, so
// it's served ONLY through the auth-gated /perspective endpoint (no public
// blob — @vercel/blob 0.27 has no private access). One alt per replay (SWU is
// 2-player), keyed by slug. Forward-only: only populated for matches recorded
// after B112 ships.
export const replayAltPayload = pgTable('replay_alt_payload', {
  replaySlug: text('replay_slug')
    .primaryKey()
    .references(() => replays.slug, { onDelete: 'cascade' }),
  // The account that recorded this alt perspective. Drives the "both recorders
  // are members of the shared team" authorization check; set null if they
  // delete their account.
  altUserId: text('alt_user_id').references(() => users.id, { onDelete: 'set null' }),
  // The alt's localPlayerId — the player rendered at the bottom when flipped.
  altOwnerPlayerId: text('alt_owner_player_id'),
  // Stale-snapshot guard: the alt recorder uploads periodic + finalize snapshots;
  // a later snapshot only wins if its actionCount is >= this.
  altActionCount: integer('alt_action_count').notNull().default(0),
  // The 2nd POV's raw payload JSON text (same encoding as the canonical blob).
  payload: text('payload').notNull(),
  // B114: client metadata for the ALT recorder (same shape as replays.clientMeta)
  // so a double-sided replay records BOTH recorders' extension versions.
  altClientMeta: jsonb('alt_client_meta'),
});

export type ReplayAltPayload = typeof replayAltPayload.$inferSelect;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

// ----- B71: per-tag team scope (comment audience)
//
// A tag/comment is visible to the set of teams listed here. Empty set
// (no rows for a tag) = personal — only the author sees it. Invariant
// enforced at write time: this set is always a SUBSET of the teams the
// replay is shared with (replay_team_shares), so a comment can never
// reach a team that can't see the underlying replay.
//
// Mirrors replay_team_shares' shape (join table, composite PK, both-way
// indexes). Tags scoped to no team simply have zero rows here, which is
// why every tag-read site must LEFT/anti-join rather than assume a row.
export const tagTeamScope = pgTable(
  'tag_team_scope',
  {
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.teamSlug] }),
    teamIdx: index('tag_team_scope_team_idx').on(t.teamSlug),
    tagIdx: index('tag_team_scope_tag_idx').on(t.tagId),
  })
);

export type TagTeamScope = typeof tagTeamScope.$inferSelect;

// ----- B101: Stats / Meta (ADR 0007) -----
//
// Facts mined from replay frames by lib/statsExtract, materialized so all
// aggregation is plain SQL — never re-decoding payload blobs at read time.
// Written at upload + a one-time backfill; rolled up by a cron (P1). Scope
// (personal / team / global) is resolved by joining `matches.replaySlug` back
// to `replays` (uploader + team shares). The ADR's single `match_facts` is
// split here into `matches` (one row/game) + `match_players` (one row/game/
// player) — the per-player shape makes win-rate + matchup aggregation trivial.

// Card catalog, keyed by SET_NNN. Seeded from karabast-dev and SELF-HEALING:
// extraction upserts any unknown cardId straight from the payload's card
// object, so spoiler-season cards register the first time anyone plays one.
export const cards = pgTable('cards', {
  cardId: text('card_id').primaryKey(), // 'SOR_001'
  name: text('name'),
  set: text('set'),
  number: integer('number'),
  aspects: jsonb('aspects').$type<string[]>(),
  cost: integer('cost'),
  type: text('type'), // unit | event | upgrade | leader | base
  arena: text('arena'), // ground | space | null
  traits: jsonb('traits').$type<string[]>(),
  // For BASES: true when the base has rules text (an Epic Action) — i.e. it
  // defines a deck (Tarkintown, Energy Conversion Lab, the LAW "splash" bases),
  // vs a vanilla aspect+HP base that's interchangeable. Drives the deck axis:
  // ability bases stay distinct, vanilla bases collapse to their aspect. Null
  // for non-bases / not-yet-seeded.
  hasAbility: boolean('has_ability'),
  source: text('source').notNull().default('observed'), // 'seed' | 'observed'
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per game. gameId is the dedup key (replays.gameId is already unique,
// and multi-perspective uploads upsert into one replay). replaySlug drives
// scope + cascades when the replay is deleted.
export const matches = pgTable(
  'matches',
  {
    gameId: text('game_id').primaryKey(),
    replaySlug: text('replay_slug')
      .notNull()
      .references(() => replays.slug, { onDelete: 'cascade' }),
    format: text('format'), // premier | eternal | open | limited | null
    cardPool: text('card_pool'),
    bo3: boolean('bo3'),
    result: text('result').notNull(), // decisive | draw | unknown
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    replayIdx: index('matches_replay_idx').on(t.replaySlug),
    formatIdx: index('matches_format_idx').on(t.format),
  })
);

// One row per (game, player) — the friendly shape for win-rate aggregation.
// opponentLeader/base are denormalized so the leader-vs-leader matrix needs no
// self-join. `won` is null when there's no winner signal (abandon/disconnect).
export const matchPlayers = pgTable(
  'match_players',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => matches.gameId, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull(),
    username: text('username'),
    leader: text('leader'), // cardId
    base: text('base'),
    aspects: jsonb('aspects').$type<string[]>(),
    isRecorder: boolean('is_recorder').notNull().default(false),
    won: boolean('won'),
    opponentLeader: text('opponent_leader'),
    opponentBase: text('opponent_base'),
    format: text('format'), // denormalized for filtered aggregation
    // B101/Phase 3: resourcing rating, RECORDER ROW ONLY (first-person — we have
    // full info only for the recorder). Raw components of the efficiency metric
    // (1 − wasted/available over counted rounds); null on opponent rows + games
    // recorded before this column. Aggregated into the /stats Resourcing trend.
    resourceAvailable: integer('resource_available'),
    resourceWasted: integer('resource_wasted'),
    resourceForced: integer('resource_forced'),
    resourceUnderspend: integer('resource_underspend'),
    resourceDeadCards: integer('resource_dead_cards'),
    resourceCountedRounds: integer('resource_counted_rounds'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.gameId, t.playerId] }),
    leaderIdx: index('match_players_leader_idx').on(t.leader),
    matchupIdx: index('match_players_matchup_idx').on(t.leader, t.opponentLeader),
  })
);

// Append-only card-level facts — one row per (card uuid, event) per game.
// `attribution` ('both' | 'recorder') keeps recorder-side vs whole-meta stats
// honest at query time. `format` denormalized so the hot card-stat query can
// filter without joining `matches`.
export const cardEvents = pgTable(
  'card_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => matches.gameId, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull(),
    isRecorder: boolean('is_recorder').notNull().default(false),
    cardId: text('card_id').notNull(),
    event: text('event').notNull(), // drawn | resourced | played | discarded
    attribution: text('attribution').notNull(), // both | recorder
    frameIndex: integer('frame_index').notNull(),
    sideWon: boolean('side_won'),
    format: text('format'),
  },
  (t) => ({
    gameIdx: index('card_events_game_idx').on(t.gameId),
    cardEventIdx: index('card_events_card_event_idx').on(t.cardId, t.event),
  })
);

export type Card = typeof cards.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type MatchPlayerRow = typeof matchPlayers.$inferSelect;
export type CardEventRow = typeof cardEvents.$inferSelect;

// ----- B124: Team tournaments (Swiss / Bo3, async)
//
// A tournament belongs to ONE team. Entrants are their own entity — userId is
// OPTIONAL (null = a GUEST the organizer manages fully manually: name, deck,
// results). All automation (self-registration, self-reporting, replay-derived
// suggestions) applies only to account-linked entrants and degrades to
// organizer-manual for guests.
//
// Standings are DERIVED on read (lib/swiss.ts computeStandings) — no standings
// table. Per-game results live in `games` jsonb on the match row: each game is
// tiny, always read/written with its match, and never queried independently.
// A bye is a match row with entrant2Id = null (pre-confirmed 2-0) so "every
// active entrant appears in every round" holds and bye history falls out of
// the same matches query.

// Registered decklist snapshot — IDeckData-shaped (app/_utils/fetchDeckData),
// card refs as {id: 'SET_NNN', count}. Frozen at registration: the link can
// drift after, the snapshot is what was registered.
export interface TournamentDeckCard {
  id: string;
  count: number;
}
export interface TournamentDeck {
  leader: TournamentDeckCard | null;
  secondleader?: TournamentDeckCard | null;
  base: TournamentDeckCard | null;
  deck: TournamentDeckCard[];
  sideboard: TournamentDeckCard[];
}

// One game of a Bo3 (or longer) series. winner = entrantId, null = draw /
// unfinished. replaySlug links the recorded evidence when the result came from
// a replay (no FK — replay deletion leaves a dangling slug the UI renders as
// plain text).
export interface TournamentGame {
  winner: string | null;
  replaySlug?: string;
}

export const tournaments = pgTable(
  'tournaments',
  {
    id: text('id').primaryKey(), // generateSlug('tn_', 8)
    teamSlug: text('team_slug')
      .notNull()
      .references(() => teams.slug, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('setup'), // 'setup' | 'active' | 'complete'
    // Future-proofing only — v1 implements exactly swiss + bo3.
    pairingFormat: text('pairing_format').notNull().default('swiss'),
    matchFormat: text('match_format').notNull().default('bo3'),
    // Organizer-configurable decklist visibility:
    //   'open'               — team-visible from submission
    //   'hidden-until-start' — entrant-self + organizer until round 1 exists, then team
    //   'private'            — entrant-self + organizer always
    decklistVisibility: text('decklist_visibility').notNull().default('hidden-until-start'),
    plannedRounds: integer('planned_rounds'), // null → UI suggests ceil(log2(n))
    // B126: shareable invite capability — anyone with the code can view the
    // public registration page + self-register as a GUEST while status=setup.
    // Minted lazily by the organizer (null until first requested).
    inviteCode: text('invite_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    teamIdx: index('tournaments_team_slug_idx').on(t.teamSlug),
    inviteUnique: uniqueIndex('tournaments_invite_code_idx')
      .on(t.inviteCode)
      .where(sql`invite_code IS NOT NULL`),
  })
);

export const tournamentEntrants = pgTable(
  'tournament_entrants',
  {
    id: text('id').primaryKey(), // generateSlug('te_', 8)
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    // NULL = guest (not a karabuddy user). set-null on user deletion turns a
    // linked entrant into a guest, preserving tournament history.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(), // snapshot; organizer-entered for guests
    deckLink: text('deck_link'),
    deckName: text('deck_name'),
    deck: jsonb('deck').$type<TournamentDeck | null>(),
    dropped: boolean('dropped').notNull().default(false),
    // B126: per-GUEST-entrant claim secret. A guest who later creates a
    // karabuddy account claims their entry with it — sets userId, renames to
    // the account, and joins the team. Null for linked entrants.
    claimToken: text('claim_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tournamentIdx: index('tournament_entrants_tournament_idx').on(t.tournamentId),
    // One registration per ACCOUNT per tournament; guests (null userId) are
    // exempt — the organizer can add any number of them.
    userUnique: uniqueIndex('tournament_entrants_tournament_user_idx')
      .on(t.tournamentId, t.userId)
      .where(sql`user_id IS NOT NULL`),
  })
);

export const tournamentRounds = pgTable(
  'tournament_rounds',
  {
    id: text('id').primaryKey(), // generateSlug('tr_', 8)
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(), // 1-based
    status: text('status').notNull().default('active'), // 'active' | 'complete'
    // Seed for the pairing shuffle — stored so a round's pairings are
    // reproducible from (entrants, prior matches, seed) in tests/audits.
    pairingSeed: text('pairing_seed').notNull(),
    // Also the lower bound for replay→result detection in this round.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    numberUnique: uniqueIndex('tournament_rounds_tournament_number_idx').on(t.tournamentId, t.number),
  })
);

export const tournamentMatches = pgTable(
  'tournament_matches',
  {
    id: text('id').primaryKey(), // generateSlug('tm_', 8)
    roundId: text('round_id')
      .notNull()
      .references(() => tournamentRounds.id, { onDelete: 'cascade' }),
    // Denormalized so standings are one query over the tournament's matches.
    tournamentId: text('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    tableNumber: integer('table_number').notNull(),
    entrant1Id: text('entrant1_id')
      .notNull()
      .references(() => tournamentEntrants.id, { onDelete: 'cascade' }),
    // NULL = bye for entrant1.
    entrant2Id: text('entrant2_id').references(() => tournamentEntrants.id, { onDelete: 'cascade' }),
    games: jsonb('games').$type<TournamentGame[]>().notNull().default([]),
    // 'pending' → no result yet; 'reported' → a paired linked player (or a
    // confirmed replay suggestion) entered a score; 'confirmed' → organizer
    // locked it (players can no longer change it; the organizer always can).
    status: text('status').notNull().default('pending'),
    resultSource: text('result_source'), // 'manual' | 'replays' | null
    reportedBy: text('reported_by'), // userId of the last reporter (audit)
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roundIdx: index('tournament_matches_round_idx').on(t.roundId),
    tournamentIdx: index('tournament_matches_tournament_idx').on(t.tournamentId),
  })
);

export type Tournament = typeof tournaments.$inferSelect;
export type TournamentEntrant = typeof tournamentEntrants.$inferSelect;
export type TournamentRound = typeof tournamentRounds.$inferSelect;
export type TournamentMatch = typeof tournamentMatches.$inferSelect;
