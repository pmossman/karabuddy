import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PATCH as patchReplay } from '@/app/api/replays/[slug]/route';
import { GET as getTags, POST as postTag } from '@/app/api/replays/[slug]/tags/route';
import { GET as getPublicList } from '@/app/api/replays/public/route';
import { getDb } from '@/lib/db';
import { users, replays, teams, teamMembers } from '@/lib/schema';

// B133: owner-controlled public replays — publish toggle, redacted comment
// reads for non-entitled viewers, and the public listing.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
const { auth } = await import('@/auth');
const mockedAuth = vi.mocked(auth);

async function seedUser(name: string) {
  const id = randomUUID();
  await getDb().insert(users).values({ id, name, email: `${id}@e.com` });
  return id;
}
async function seedReplay(slug: string, userId: string | null) {
  await getDb().insert(replays).values({
    slug, gameId: randomUUID(), userId, ownerToken: `kbx_${randomUUID()}`,
    players: [
      { id: 'p1', username: 'RealHandleOne' },
      { id: 'p2', username: 'RealHandleTwo' },
    ],
    ownerPlayerId: 'p1',
    payloadBlobUrl: `https://blob.test/${slug}.json`,
  });
}
const as = (userId: string | null) =>
  mockedAuth.mockResolvedValue(userId ? ({ user: { id: userId, name: 'u' } } as any) : null);
const patch = (slug: string, body: unknown) =>
  patchReplay(new Request('http://test', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
const post = (slug: string, body: unknown) =>
  postTag(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });
const get = (slug: string) =>
  getTags(new Request('http://test'), { params: Promise.resolve({ slug }) });

beforeEach(() => mockedAuth.mockReset());

describe('B133: publish toggle', () => {
  it('owner publishes/unpublishes; a stranger gets 403', async () => {
    const owner = await seedUser('Owner');
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    await seedReplay(slug, owner);

    const stranger = await seedUser('Stranger');
    as(stranger);
    expect((await patch(slug, { public: true })).status).toBe(403);

    as(owner);
    expect((await patch(slug, { public: true })).status).toBe(200);
    expect((await patch(slug, { public: false })).status).toBe(200);
  });
});

describe('B133: redacted public comment reads', () => {
  it('a stranger sees ALL tags redacted on a public replay; none when unlisted', async () => {
    const owner = await seedUser('Owner2');
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    await seedReplay(slug, owner);

    // A player comments anonymously under their karabast handle (the
    // extension path — signed-in comments carry the ACCOUNT name per B84, so
    // only handle-named tags can match a player); an anonymous friend
    // comments with a free-typed mention in the text.
    as(null);
    await post(slug, { installToken: 'kbx_owner_tok', authorName: 'RealHandleOne', frameIndex: 1, comment: 'kept the lead here' });
    await post(slug, { installToken: `kb_${randomUUID()}`, authorName: 'SecretFriend', frameIndex: 2, comment: 'ask @luke about this line' });

    // Unlisted: a signed-out viewer sees nothing.
    as(null);
    let body = await (await get(slug)).json();
    expect(body.data).toHaveLength(0);

    // Published: the same viewer sees BOTH tags, redacted.
    as(owner);
    await patch(slug, { public: true });
    as(null);
    body = await (await get(slug)).json();
    expect(body.data).toHaveLength(2);
    const names = body.data.map((t: any) => t.authorName).sort();
    // RealHandleOne matches player 1 (owner-first) → Player1; the friend → Reviewer N.
    expect(names).toEqual(['Player1', 'Reviewer 1']);
    expect(JSON.stringify(body.data)).not.toContain('SecretFriend');
    expect(body.data.find((t: any) => t.frameIndex === 2).comment).toBe('ask @[redacted] about this line');
    for (const t of body.data) {
      expect(t.userId).toBeNull();
      expect(t.authorToken).toBe('');
      expect(t.mentions).toBeNull();
    }

    // The owner still reads it raw (B131).
    as(owner);
    body = await (await get(slug)).json();
    expect(body.data.map((t: any) => t.authorName).sort()).toEqual(['RealHandleOne', 'SecretFriend'].sort());

    // A teammate (identity-entitled) keeps the normal SCOPED read — they are
    // not the owner, so a personal tag stays hidden rather than redacted.
    const mate = await seedUser('Mate');
    const teamSlug = `t${randomUUID().slice(0, 6)}`;
    await getDb().insert(teams).values({ slug: teamSlug, name: teamSlug, createdBy: owner });
    await getDb().insert(teamMembers).values([
      { teamSlug, userId: owner, role: 'owner' },
      { teamSlug, userId: mate, role: 'member' },
    ]);
    as(mate);
    body = await (await get(slug)).json();
    expect(body.data).toHaveLength(0);

    // Unpublish → the stranger is locked out again.
    as(owner);
    await patch(slug, { public: false });
    as(null);
    body = await (await get(slug)).json();
    expect(body.data).toHaveLength(0);
  });
});

describe('B133: public listing', () => {
  it('lists published replays anonymized, without auth', async () => {
    const owner = await seedUser('Owner3');
    const slug = `rep-${randomUUID().slice(0, 8)}`;
    await seedReplay(slug, owner);
    as(owner);
    await patch(slug, { public: true });

    as(null);
    const res = await getPublicList();
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.find((r: any) => r.slug === slug);
    expect(row).toBeTruthy();
    expect(row.players.map((p: any) => p.username)).toEqual(['Player1', 'Player2']);
    expect(row.userId).toBeNull();
    expect(row.ownerName).toBeNull();
    expect(JSON.stringify(row)).not.toContain('RealHandle');
  });
});
