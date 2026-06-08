// B112 DEMO seed: a self-contained double-sided replay you can test locally
// WITHOUT recording real games.
//
// It builds a replay whose CANONICAL perspective streams from a real public
// sample blob (so the board renders real cards) and synthesizes a SECOND
// perspective (the alt) by swapping the two players' hands frame-by-frame — so
// flipping re-orients the board AND reveals a believable "other" hand. Both
// recorders are seeded onto a team and the replay is shared with it, so an
// entitled team member sees the Flip control.
//
// Usually run via `npm run demo:double-sided` (which also launches the dev
// server with test sign-in enabled). It self-loads the local env and ensures
// its own table, so it never touches prod and doesn't depend on `db:migrate`.

import { config } from 'dotenv';
// Local env precedence (mirror Next/drizzle): .env.development.local wins over
// .env.local. dotenv does NOT override already-set vars, so the local
// POSTGRES_URL from the dev file stays put. Default the driver to pg (local).
config({ path: '.env.development.local' });
config({ path: '.env.local' });
process.env.KARABUDDY_DB_DRIVER ||= 'pg';

import { eq, sql } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { decodeReplay } from '../lib/replayDecoder';
import {
  users, teams, teamMembers, replays, replayTeamShares, replayParticipants, replayAltPayload,
} from '../lib/schema';

const SAMPLE_SLUG = 'r_4gkpv9';
const SAMPLE_API = `https://karabuddy.app/api/replays/${SAMPLE_SLUG}`;

const DEMO = {
  slug: 'r_demo01',
  gameId: 'demo-double-sided-01',
  team: { slug: 'demoteam', name: 'Demo Team' },
  you: { id: 'demo-user-you', name: 'Demo You', email: 'demo-you@karabuddy.test' },
  mate: { id: 'demo-user-mate', name: 'Demo Teammate', email: 'demo-mate@karabuddy.test' },
};

function assertLocal() {
  const url = process.env.POSTGRES_URL || '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run: POSTGRES_URL is not local (${url.replace(/:[^@]*@/, ':***@')}). This script is local-demo only.`);
  }
}

// Idempotently ensure the B112 side table exists (so the demo works even if the
// local DB hasn't had the 0020 migration applied — drizzle-kit can mis-track a
// hand-written migration without creating the table). Matches drizzle/0020.
async function ensureAltTable(db: ReturnType<typeof getDb>) {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "replay_alt_payload" (
    "replay_slug" text PRIMARY KEY NOT NULL REFERENCES "replays"("slug") ON DELETE cascade,
    "alt_user_id" text REFERENCES "users"("id") ON DELETE set null,
    "alt_owner_player_id" text,
    "alt_action_count" integer DEFAULT 0 NOT NULL,
    "payload" text NOT NULL
  )`);
}

async function main() {
  assertLocal();
  const db = getDb();
  await ensureAltTable(db);

  console.log(`Fetching sample replay ${SAMPLE_SLUG} (metadata + payload)…`);
  const meta = (await (await fetch(SAMPLE_API)).json()).data ?? (await (await fetch(SAMPLE_API)).json());
  if (!meta?.payloadBlobUrl) throw new Error('sample API did not return payloadBlobUrl');
  const payload = await (await fetch(meta.payloadBlobUrl)).json();

  // Identify the two karabast player ids + which one is the canonical POV.
  const decoded = decodeReplay(payload);
  const firstPlayers = decoded.frames[0]?.state?.players || {};
  const playerIds = Object.keys(firstPlayers);
  if (playerIds.length < 2) throw new Error('expected a 2-player replay');
  const canonicalPid: string = (meta.ownerPlayerId && playerIds.includes(meta.ownerPlayerId))
    ? meta.ownerPlayerId
    : (typeof payload.localPlayerId === 'string' && playerIds.includes(payload.localPlayerId) ? payload.localPlayerId : playerIds[0]);
  const otherPid: string = playerIds.find((p) => p !== canonicalPid)!;

  // Synthesize the ALT perspective. A single recording only has ONE real hand
  // (the recorder's), so to make the flip show a believably DIFFERENT hand we:
  //   - give the OTHER player a distinct, real-rendering hand built from their
  //     own cards seen on board / in discard across the match, and
  //   - mask the original recorder's hand (drop card identity → face-down),
  // then re-encode as full frames with localPlayerId = otherPid.
  // (Real double-sided replays get each player's genuine hand from the two
  // actual recordings — this fabrication is only because the demo has one.)
  const pool = new Map<string, any>();
  for (const f of decoded.frames) {
    const piles = f.state?.players?.[otherPid]?.cardPiles || {};
    for (const z of ['groundArena', 'spaceArena', 'discard']) {
      for (const c of (piles[z] || [])) {
        const key = c && (c.id ?? '') + ':' + JSON.stringify(c.setId ?? null);
        if (c && (c.id || c.setId) && c.uuid && !pool.has(key)) pool.set(key, c);
      }
    }
  }
  const otherHand = [...pool.values()].slice(0, 6).map((c, i) => ({
    ...JSON.parse(JSON.stringify(c)), uuid: `demo-alt-hand-${i}`, zone: 'hand', exhausted: false, damage: 0,
  }));
  const maskHand = (hand: any[]): any[] => (hand || []).map((c, i) => ({ uuid: c?.uuid ?? `demo-mask-${i}`, zone: 'hand' }));

  const altEvents = decoded.frames.map((f) => {
    const state = JSON.parse(JSON.stringify(f.state));
    const can = state?.players?.[canonicalPid]?.cardPiles;
    const oth = state?.players?.[otherPid]?.cardPiles;
    if (can) can.hand = maskHand(can.hand);                       // recorder is now the masked opponent
    if (oth) oth.hand = JSON.parse(JSON.stringify(otherHand));    // distinct visible hand for the flipped POV
    return { event: 'gamestate', args: [{ full: state }] };
  });
  console.log(`  synthesized alt hand for ${otherPid.slice(0, 8)} from ${otherHand.length} of their own cards`);
  const altPayload = JSON.stringify({
    version: 2,
    localPlayerId: otherPid,
    durationMs: payload.durationMs ?? meta.durationMs ?? 0,
    actionCount: meta.actionCount ?? 0,
    match: payload.match ?? meta.match ?? null,
    decks: payload.decks ?? meta.decks ?? null,
    events: altEvents,
    tags: [],
  });

  console.log(`  canonical POV = ${canonicalPid.slice(0, 8)}, alt POV = ${otherPid.slice(0, 8)}, frames = ${decoded.frames.length}, alt size = ${(altPayload.length / 1024).toFixed(0)}KB`);

  // ---- Seed (idempotent) ----
  // Clear any prior demo replay (cascades to alt/shares/participants).
  await db.delete(replays).where(eq(replays.slug, DEMO.slug));

  for (const u of [DEMO.you, DEMO.mate]) {
    await db.insert(users).values({ id: u.id, name: u.name, email: u.email }).onConflictDoNothing();
  }
  await db.insert(teams).values({ slug: DEMO.team.slug, name: DEMO.team.name, createdBy: DEMO.you.id }).onConflictDoNothing();
  await db.insert(teamMembers).values([
    { teamSlug: DEMO.team.slug, userId: DEMO.you.id, role: 'owner' },
    { teamSlug: DEMO.team.slug, userId: DEMO.mate.id, role: 'member' },
  ]).onConflictDoNothing();

  // Make the demo viewable by whoever is signed in locally: add every existing
  // local account to the demo team. The Flip gate requires the VIEWER to be on a
  // team the replay is shared with where BOTH recorders are members — so adding
  // your real (OAuth) account here lets you view + flip as yourself, no test
  // sign-in needed.
  const existing = await db.select({ id: users.id }).from(users);
  const realUsers = existing.filter((u) => u.id !== DEMO.you.id && u.id !== DEMO.mate.id);
  if (realUsers.length) {
    await db.insert(teamMembers)
      .values(realUsers.map((u) => ({ teamSlug: DEMO.team.slug, userId: u.id, role: 'member' as const })))
      .onConflictDoNothing();
  }

  await db.insert(replays).values({
    slug: DEMO.slug,
    gameId: DEMO.gameId,
    userId: DEMO.you.id,                 // canonical recorder
    ownerToken: 'kbx_demo_you',
    players: meta.players,               // [{id, username, leader, base}] from the sample
    durationMs: meta.durationMs ?? 0,
    actionCount: meta.actionCount ?? 0,
    payloadBlobUrl: meta.payloadBlobUrl, // canonical streams from the real public blob
    payloadSizeBytes: meta.payloadSizeBytes ?? 0,
    match: meta.match ?? null,
    decks: meta.decks ?? null,
    winners: meta.winners ?? null,
    ownerPlayerId: canonicalPid,
    displayName: 'B112 demo — double-sided replay',
  });

  await db.insert(replayTeamShares).values({ replaySlug: DEMO.slug, teamSlug: DEMO.team.slug, sharedBy: DEMO.you.id }).onConflictDoNothing();
  await db.insert(replayParticipants).values([
    { replaySlug: DEMO.slug, userId: DEMO.you.id },
    { replaySlug: DEMO.slug, userId: DEMO.mate.id },
  ]).onConflictDoNothing();
  await db.insert(replayAltPayload).values({
    replaySlug: DEMO.slug,
    altUserId: DEMO.mate.id,             // the SECOND recorder
    altOwnerPlayerId: otherPid,
    altActionCount: meta.actionCount ?? 0,
    payload: altPayload,
  });

  const bar = '─'.repeat(72);
  console.log(`\n✅ Seeded the demo (added ${realUsers.length} existing local account(s) to the demo team).\n${bar}`);
  console.log(`Just open  http://localhost:3001/r/${DEMO.slug}  while signed in with your`);
  console.log('normal local account — you were added to the demo team, so the "⇄" Flip');
  console.log('control appears (desktop pill, bottom-right / mobile controls bubble →');
  console.log('"Perspective"). Click it to switch between the two players\' perspectives.');
  console.log(`\nNot signed in (or a non-member): no Flip control, and`);
  console.log(`/api/replays/${DEMO.slug}/perspective returns 401/403.`);
  console.log('\nNo local account yet? Paste this in the console to sign in as a demo member:');
  console.log(`  (async () => { const r = await (await fetch('/api/test/sign-in',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'${DEMO.you.email}',name:'${DEMO.you.name}'})})).json(); document.cookie = r.cookieName+'='+r.cookieValue+'; path=/'; location.href='/r/${DEMO.slug}'; })()`);
  console.log('  (needs the dev server started via `npm run demo:double-sided`, which enables test sign-in)');
  console.log(bar + '\n');

  // pg pool keeps the process alive — exit so the chained `next dev` can run.
  process.exit(0);
}

main().catch((e) => { console.error('seed failed:', e); process.exit(1); });
