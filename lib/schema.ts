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
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
