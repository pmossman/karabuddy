import {
  pgTable,
  text,
  integer,
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
    // B85: the "public" concept was removed — replays are link-accessible
    // (anyone with /r/<slug>) and surface to teams via shares. No public list.
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
  },
  (t) => ({
    pk: primaryKey({ columns: [t.replaySlug, t.teamSlug] }),
    teamIdx: index('replay_team_shares_team_idx').on(t.teamSlug),
    replayIdx: index('replay_team_shares_replay_idx').on(t.replaySlug),
  })
);

export type ReplayTeamShare = typeof replayTeamShares.$inferSelect;

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
