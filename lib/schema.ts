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
  // karabuddy-specific: stash the user's karabast.net username so extension
  // uploads from a logged-in karabast user can be auto-attributed. Set
  // manually from settings until karabast offers OAuth (path 2) and we
  // can pull it from the userinfo response.
  karabastUsername: text('karabast_username'),
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
    visibility: text('visibility').notNull().default('unlisted'), // 'unlisted' | 'public'
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    replayIdx: index('tags_replay_idx').on(t.replaySlug),
    authorIdx: index('tags_author_idx').on(t.authorToken),
    userIdx: index('tags_user_idx').on(t.userId),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
