// B170 / ADR 0010 DEMO seed: a PRIVATE (E2EE) team + a real, decryptable private
// replay you can test locally WITHOUT any prod data. Creates a private team
// (privateMode + a stable team_key_id), puts every local account on it, prints
// the team key to paste, and seeds one ENCRYPTED replay (the payload + matchup
// summary + a web comment are all ciphertext, stored as the demo would store
// them — the server holds no plaintext). The payload blob is a self-contained
// data: URL so no blob infra is needed locally.
//
// Test loop once seeded (run via `npm run demo:private`, dev on :3000):
//   - Open the team dashboard / the seeded replay WITHOUT the extension → you see
//     the tiered gate + 🔒 cards (the non-keyholder baseline).
//   - Load the extension + paste the printed key in the bubble → the viewer
//     decrypts the board + the cards show the matchup.
//   - Record on karabast with "Demo Private Team" armed: no key = WITHHELD; key
//     loaded = encrypted upload.
//
// Self-loads local env + refuses to run against a non-local DB. The team key is
// a FIXED local-demo value so re-seeding never invalidates a key you've pasted.

import { config } from 'dotenv';
config({ path: '.env.development.local' });
config({ path: '.env.local' });
process.env.KARABUDDY_DB_DRIVER ||= 'pg';

import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { users, teams, teamMembers, replays, replayTeamShares, replayParticipants, tags, extensionReadiness } from '../lib/schema';
import * as e2ee from '../lib/e2ee.js';

// Stable, NON-secret local-demo team keys (43 base64url chars = 32 bytes each).
const DEMO_TEAM_KEY = 'demoDEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMOdem';
// A SECOND private team's key — distinct from the first so you can test the
// multiple-private-teams arming rules in the bubble: arming "Demo Private Team"
// disables "Demo Private Team B" ("OTHER KEY"), and vice versa (one blob can't be
// encrypted under two keys). Load both keys to confirm only one arms at a time.
const DEMO_TEAM_KEY_2 = 'kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy2kEy';
const SAMPLE_SLUG = 'r_4gkpv9'; // a public prod replay we re-encrypt for the demo
const DEMO = {
  team: { slug: 'privteam', name: 'Demo Private Team' },
  team2: { slug: 'privteam2', name: 'Demo Private Team B' },
  openTeam: { slug: 'openteam', name: 'Demo Open Team' },
  you: { id: 'demo-private-you', name: 'Demo You', email: 'demo-private-you@karabuddy.test' },
  replay: { slug: 'r_privdemo', gameId: 'demo-private-game-01' },
  openReplay: { slug: 'r_opendemo', gameId: 'demo-open-game-01' },
};

// Players array (replays.players shape) from a payload's first gamestate.
function playersArray(payload: any): any[] {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const fg = events.find((e: any) => e.event === 'gamestate' && e.args?.[0]);
  const snap = fg?.args?.[0]?.full || (payload.version === 1 ? fg?.args?.[0] : null);
  const src = snap?.players || {};
  return Object.entries(src).map(([id, p]: [string, any]) => ({
    id,
    username: p.user?.username || '',
    leader: p.leader ? { name: p.leader.name || '', set: p.leader.setId?.set || '', number: p.leader.setId?.number || 0 } : null,
    base: p.base ? { name: p.base.name || '', set: p.base.setId?.set || '', number: p.base.setId?.number || 0 } : null,
  }));
}

function assertLocal() {
  const url = process.env.POSTGRES_URL || '';
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(`Refusing to run: POSTGRES_URL is not local (${url.replace(/:[^@]*@/, ':***@')}). Local-demo only.`);
  }
}

// Build the small matchup summary the extension would compute (leaders/bases/
// usernames keyed by playerId + raw winner signal + ownerPlayerId).
function buildSummary(payload: any, meta: any) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const fg = events.find((e: any) => e.event === 'gamestate' && e.args?.[0]);
  const snap = fg?.args?.[0]?.full || (payload.version === 1 ? fg?.args?.[0] : null);
  const players: Record<string, any> = {};
  const src = snap?.players || {};
  for (const pid of Object.keys(src)) {
    const p = src[pid] || {};
    players[pid] = {
      username: p.user?.username || '',
      leader: p.leader ? { name: p.leader.name || '', set: p.leader.setId?.set || '', number: p.leader.setId?.number || 0 } : null,
      base: p.base ? { name: p.base.name || '', set: p.base.setId?.set || '', number: p.base.setId?.number || 0 } : null,
    };
  }
  return { v: 1, players, ownerPlayerId: meta.ownerPlayerId ?? payload.localPlayerId ?? null, winners: meta.winners ?? null };
}

// Encrypt a string and return a self-contained data: URL the browser can fetch.
async function dataUrl(plaintext: string): Promise<string> {
  const env = await e2ee.encryptContent(DEMO_TEAM_KEY, plaintext);
  const b64 = Buffer.from(JSON.stringify(env)).toString('base64');
  return `data:application/json;base64,${b64}`;
}

async function seedEncryptedReplay(db: ReturnType<typeof getDb>, teamKeyId: string) {
  try {
    const metaRes = await fetch(`https://karabuddy.app/api/replays/${SAMPLE_SLUG}`);
    const metaJson = await metaRes.json();
    const meta = metaJson.data ?? metaJson;
    if (!meta?.payloadBlobUrl) throw new Error('sample metadata missing payloadBlobUrl');
    const payload = await (await fetch(meta.payloadBlobUrl)).json();

    const summary = buildSummary(payload, meta);
    const payloadUrl = await dataUrl(JSON.stringify(payload));
    const summaryEnv = await e2ee.encryptContent(DEMO_TEAM_KEY, JSON.stringify(summary));

    // Idempotent: clear any prior demo replay (cascades shares/tags/participants).
    await db.delete(replays).where(eq(replays.slug, DEMO.replay.slug));
    await db.insert(replays).values({
      slug: DEMO.replay.slug,
      gameId: DEMO.replay.gameId,
      userId: DEMO.you.id,
      ownerToken: 'kbx_demo_private',
      players: [], // no plaintext identity on an encrypted row
      durationMs: payload.durationMs ?? 0,
      actionCount: payload.actionCount ?? 0,
      payloadBlobUrl: payloadUrl,
      payloadSizeBytes: payloadUrl.length,
      encrypted: true,
      teamKeyId,
      encryptedSummary: JSON.stringify(summaryEnv),
    });
    await db.insert(replayTeamShares).values({ replaySlug: DEMO.replay.slug, teamSlug: DEMO.team.slug, sharedBy: DEMO.you.id }).onConflictDoNothing();
    await db.insert(replayParticipants).values({ replaySlug: DEMO.replay.slug, userId: DEMO.you.id }).onConflictDoNothing();

    // A web-authored encrypted comment (ciphertext; the viewer decrypts it).
    const commentEnv = await e2ee.encryptContent(DEMO_TEAM_KEY, 'Nice tempo swing here — note the resource read.');
    await db.insert(tags).values({
      id: 'tag_privdemo_1',
      replaySlug: DEMO.replay.slug,
      frameIndex: 4,
      userId: DEMO.you.id,
      authorToken: 'kbx_demo_private',
      authorName: 'Demo You',
      comment: '',
      commentEncrypted: JSON.stringify(commentEnv),
    }).onConflictDoNothing();

    // A NON-private (plaintext) replay on the open team — so you can confirm the
    // normal flow still works (no gate, real matchup cards, stats), and use the
    // toggle to make that team private. Points at the prod sample blob (public,
    // read-only) so it renders without local blob infra.
    await db.delete(replays).where(eq(replays.slug, DEMO.openReplay.slug));
    await db.insert(replays).values({
      slug: DEMO.openReplay.slug,
      gameId: DEMO.openReplay.gameId,
      userId: DEMO.you.id,
      ownerToken: 'kbx_demo_open',
      players: playersArray(payload),
      durationMs: payload.durationMs ?? 0,
      actionCount: payload.actionCount ?? 0,
      payloadBlobUrl: meta.payloadBlobUrl,
      payloadSizeBytes: meta.payloadSizeBytes ?? 0,
      match: payload.match ?? null,
      decks: payload.decks ?? null,
      winners: meta.winners ?? null,
      ownerPlayerId: meta.ownerPlayerId ?? payload.localPlayerId ?? null,
    });
    await db.insert(replayTeamShares).values({ replaySlug: DEMO.openReplay.slug, teamSlug: DEMO.openTeam.slug, sharedBy: DEMO.you.id }).onConflictDoNothing();
    await db.insert(replayParticipants).values({ replaySlug: DEMO.openReplay.slug, userId: DEMO.you.id }).onConflictDoNothing();

    return DEMO.replay.slug;
  } catch (e) {
    console.warn('  ⚠️  could not seed the encrypted demo replay (team still seeded):', (e as Error).message);
    return null;
  }
}

async function main() {
  assertLocal();
  const db = getDb();

  const teamKeyId = await e2ee.teamKeyId(DEMO_TEAM_KEY);
  const teamKeyId2 = await e2ee.teamKeyId(DEMO_TEAM_KEY_2);

  await db.insert(users).values(DEMO.you).onConflictDoNothing();
  await db
    .insert(teams)
    .values({ slug: DEMO.team.slug, name: DEMO.team.name, createdBy: DEMO.you.id, privateMode: true, teamKeyId })
    .onConflictDoUpdate({ target: teams.slug, set: { privateMode: true, teamKeyId } });
  // A SECOND private team with a DIFFERENT key — for testing multiple private
  // teams in the bubble (arming one disables the other: "OTHER KEY").
  await db
    .insert(teams)
    .values({ slug: DEMO.team2.slug, name: DEMO.team2.name, createdBy: DEMO.you.id, privateMode: true, teamKeyId: teamKeyId2 })
    .onConflictDoUpdate({ target: teams.slug, set: { privateMode: true, teamKeyId: teamKeyId2 } });
  // A NON-private team to test the normal flow + the "make private" toggle on.
  await db
    .insert(teams)
    .values({ slug: DEMO.openTeam.slug, name: DEMO.openTeam.name, createdBy: DEMO.you.id, privateMode: false, teamKeyId: null })
    .onConflictDoUpdate({ target: teams.slug, set: { privateMode: false, teamKeyId: null } });

  const everyone = await db.select({ id: users.id }).from(users);
  for (const slug of [DEMO.team.slug, DEMO.team2.slug, DEMO.openTeam.slug]) {
    await db
      .insert(teamMembers)
      .values(everyone.map((u) => ({ teamSlug: slug, userId: u.id, role: u.id === DEMO.you.id ? 'owner' : 'member' })))
      .onConflictDoNothing();
  }

  // Demo teammates with varied readiness so the owner's roster shows the full
  // range (ready / needs-key / needs-update / not-seen).
  const roster = [
    { id: 'demo-mate-ready', name: 'Ada (ready)', caps: ['privateTeams'], kids: [teamKeyId] },
    { id: 'demo-mate-nokey', name: 'Ben (needs key)', caps: ['privateTeams'], kids: ['some-other-kid'] },
    { id: 'demo-mate-oldext', name: 'Cleo (old extension)', caps: [], kids: [] },
    { id: 'demo-mate-notseen', name: 'Dane (not seen)', caps: null as string[] | null, kids: null as string[] | null },
  ];
  for (const m of roster) {
    await db.insert(users).values({ id: m.id, name: m.name, email: `${m.id}@karabuddy.test` }).onConflictDoNothing();
    await db.insert(teamMembers).values({ teamSlug: DEMO.team.slug, userId: m.id, role: 'member' }).onConflictDoNothing();
    if (m.caps !== null) {
      await db
        .insert(extensionReadiness)
        .values({ userId: m.id, capabilities: m.caps, loadedKeyIds: m.kids ?? [], updatedAt: new Date() })
        .onConflictDoUpdate({ target: extensionReadiness.userId, set: { capabilities: m.caps, loadedKeyIds: m.kids ?? [] } });
    }
  }

  const replaySlug = await seedEncryptedReplay(db, teamKeyId);

  console.log('\n  ✅ Seeded private team "%s" (slug: %s)', DEMO.team.name, DEMO.team.slug);
  console.log('     privateMode = true, team_key_id = %s, members = %d', teamKeyId, everyone.length);
  if (replaySlug) console.log('     encrypted replay: /r/%s (shared to the team, 1 encrypted comment)', replaySlug);
  console.log('\n  ✅ Seeded 2nd PRIVATE team "%s" (slug: %s) — different key, for', DEMO.team2.name, DEMO.team2.slug);
  console.log('     testing multiple private teams in the bubble (arming one disables the other).');
  console.log('\n  ✅ Seeded OPEN (non-private) team "%s" (slug: %s)', DEMO.openTeam.name, DEMO.openTeam.slug);
  console.log('     plaintext replay: /r/%s — renders normally; flip it private via team Settings → "Make this team private"', DEMO.openReplay.slug);
  console.log('\n  🔑 Team keys (paste into the bubble\'s "🔒 no key" chip):\n');
  console.log('       %s   ← Demo Private Team', DEMO_TEAM_KEY);
  console.log('       %s   ← Demo Private Team B\n', DEMO_TEAM_KEY_2);
  console.log('  The server NEVER receives these keys — only the non-secret ids above.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
