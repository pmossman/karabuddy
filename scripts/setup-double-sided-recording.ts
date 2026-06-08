// B112: set up the LOCAL environment to record a REAL double-sided replay —
// the same karabast game captured from two different karabuddy accounts, which
// is exactly the production path (canonical + alt). No fabrication.
//
// What it does (idempotent, local-only):
//   - creates two karabuddy accounts (Recorder A / Recorder B) and PRE-LINKS a
//     known install token to each (so the extension uploads attribute to them
//     without any in-browser karabuddy sign-in),
//   - puts both on a team (plus every existing local account, so YOU can view +
//     flip as yourself),
//   - lowers each account's min-upload-actions to 1 and auto-shares their
//     uploads with the team (so even a short game uploads + is shareable).
//
// Then play one short karabast game across two browser profiles (one token
// each) and both recordings land as a single double-sided replay.
//
//   npm run demo:double-sided:record-setup

import { config } from 'dotenv';
config({ path: '.env.development.local' });
config({ path: '.env.local' });
process.env.KARABUDDY_DB_DRIVER ||= 'pg';

import { sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { users, extensionTokens, teams, teamMembers } from '../lib/schema';

const TEAM = { slug: 'recdemo', name: 'Recording Demo Team' };
const A = { id: 'demo-rec-a', name: 'Recorder A', email: 'rec-a@karabuddy.test', token: 'kbx_demo_rec_a' };
const B = { id: 'demo-rec-b', name: 'Recorder B', email: 'rec-b@karabuddy.test', token: 'kbx_demo_rec_b' };
const ENDPOINT = 'http://localhost:3001';

function assertLocal() {
  const url = process.env.POSTGRES_URL || '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run: POSTGRES_URL is not local (${url.replace(/:[^@]*@/, ':***@')}).`);
  }
}

async function ensureAltTable(db: ReturnType<typeof getDb>) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "replay_alt_payload" (
    "replay_slug" text PRIMARY KEY NOT NULL REFERENCES "replays"("slug") ON DELETE cascade,
    "alt_user_id" text REFERENCES "users"("id") ON DELETE set null,
    "alt_owner_player_id" text, "alt_action_count" integer DEFAULT 0 NOT NULL, "payload" text NOT NULL
  )`);
}

async function main() {
  assertLocal();
  const db = getDb();
  await ensureAltTable(db);

  for (const u of [A, B]) {
    await db.insert(users)
      .values({ id: u.id, name: u.name, email: u.email, minUploadActions: 1, defaultShareTeamSlugs: [TEAM.slug] })
      .onConflictDoUpdate({ target: users.id, set: { minUploadActions: 1, defaultShareTeamSlugs: [TEAM.slug] } });
    await db.insert(extensionTokens)
      .values({ token: u.token, userId: u.id })
      .onConflictDoUpdate({ target: extensionTokens.token, set: { userId: u.id } });
  }

  await db.insert(teams).values({ slug: TEAM.slug, name: TEAM.name, createdBy: A.id }).onConflictDoNothing();
  await db.insert(teamMembers).values([
    { teamSlug: TEAM.slug, userId: A.id, role: 'owner' },
    { teamSlug: TEAM.slug, userId: B.id, role: 'member' },
  ]).onConflictDoNothing();
  // Add every real local account so you can view + flip as yourself.
  const existing = await db.select({ id: users.id }).from(users);
  const real = existing.filter((u) => u.id !== A.id && u.id !== B.id);
  if (real.length) {
    await db.insert(teamMembers)
      .values(real.map((u) => ({ teamSlug: TEAM.slug, userId: u.id, role: 'member' as const })))
      .onConflictDoNothing();
  }

  const snippet = (token: string) =>
    `chrome.storage.local.set({ karabuddyEndpoint: '${ENDPOINT}', karabuddyInstallToken: '${token}' })`;
  const bar = '─'.repeat(74);
  console.log(`\n✅ Ready to record a real double-sided replay (added ${real.length} local account(s) to the team).\n${bar}`);
  console.log('PREREQ: the dev server must be running (npm run dev) so uploads hit localhost.\n');
  console.log('Use TWO browser profiles that are NOT signed into local karabuddy (e.g. a');
  console.log('fresh Chrome profile + Chromium), EACH with the unpacked extension loaded.');
  console.log('(If a profile is signed into local karabuddy, its bridge would re-claim the');
  console.log(' pre-linked token to that account — so keep these two recording profiles');
  console.log(' signed out of karabuddy. You can be signed in karabast as anonymous/guest.)\n');
  console.log('In EACH profile: chrome://extensions → the extension → "service worker" →');
  console.log('Console, then paste the matching line:\n');
  console.log(`  Profile 1 (Recorder A):  ${snippet(A.token)}`);
  console.log(`  Profile 2 (Recorder B):  ${snippet(B.token)}`);
  console.log('\nThen reload any open karabast.net tab in each profile so the extension');
  console.log('picks up the endpoint + token.\n');
  console.log('Play one short game between the two profiles:');
  console.log('  1. Profile 1: karabast.net → Play → CREATE a private/custom lobby, copy the link.');
  console.log('  2. Profile 2: open that link → join the second seat.');
  console.log('  3. Play a handful of actions EACH (threshold is set to 1), then finish the');
  console.log('     game (or just close — the recorder also uploads on game-end/periodic).');
  console.log('  4. Both extensions upload to local karabuddy → same gameId → stored as a');
  console.log('     single CANONICAL + ALT (double-sided) replay, auto-shared with the team.');
  console.log('\nTO VIEW: grab the replay URL (the footer "Open on karabuddy →" link shows the');
  console.log('slug), then open  http://localhost:3001/r/<slug>  in YOUR normal profile where');
  console.log('you are signed into local karabuddy — you are on the team, so the "⇄" Flip');
  console.log('control appears and switches between the two REAL perspectives.');
  console.log(`${bar}\n`);
  console.log('Tip: only ONE karabast window per profile while playing (a 2nd window steals');
  console.log('the game socket — see B111).');

  process.exit(0);
}

main().catch((e) => { console.error('setup failed:', e); process.exit(1); });
