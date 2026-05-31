import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db';
import { users, teams, teamMembers } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// B81: bot-in-server connect flow — callback binds a guild (owner-only),
// the discord route lists/sets the channel, the test route posts.

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/discord', () => ({
  listGuildTextChannels: vi.fn(async () => [{ id: 'c1', name: 'general' }, { id: 'c2', name: 'reviews' }]),
  postToChannel: vi.fn(async () => ({ ok: true })),
}));
const { auth } = await import('@/auth');
const { postToChannel } = await import('@/lib/discord');
const { GET: callback } = await import('@/app/api/discord/callback/route');
const { GET: getDiscord, PATCH: patchDiscord } = await import('@/app/api/teams/[slug]/discord/route');
const { POST: testPost } = await import('@/app/api/teams/[slug]/discord/test/route');

const as = (id: string | null) => vi.mocked(auth).mockResolvedValue(id ? ({ user: { id } } as any) : (null as any));
async function seedOwnedTeam() {
  const owner = randomUUID();
  const slug = randomUUID().slice(0, 6);
  const db = getDb();
  await db.insert(users).values({ id: owner, name: 'O', email: `${owner}@e.com` });
  await db.insert(teams).values({ slug, name: 'Squad', createdBy: owner });
  await db.insert(teamMembers).values({ teamSlug: slug, userId: owner, role: 'owner' });
  return { owner, slug };
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const body = (m: string, b?: unknown) => new Request('http://t', { method: m, body: b === undefined ? undefined : JSON.stringify(b) });

beforeEach(() => vi.mocked(auth).mockReset());

describe('GET /api/discord/callback (bot-invite return)', () => {
  it('binds the guild to the team for an owner and redirects to connected', async () => {
    const { owner, slug } = await seedOwnedTeam();
    as(owner);
    const res = await callback(new Request(`http://t/api/discord/callback?guild_id=guild-99&state=${slug}`));
    expect(res.headers.get('location')).toContain('discord=connected');
    const [team] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(team.discordGuildId).toBe('guild-99');
  });
  it('refuses a non-owner and does not bind the guild', async () => {
    const { slug } = await seedOwnedTeam();
    const stranger = randomUUID();
    await getDb().insert(users).values({ id: stranger, name: 'S', email: `${stranger}@e.com` });
    as(stranger);
    const res = await callback(new Request(`http://t/api/discord/callback?guild_id=guild-x&state=${slug}`));
    expect(res.headers.get('location')).toContain('discord=forbidden');
    const [team] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(team.discordGuildId).toBeNull();
  });
});

describe('GET/PATCH /api/teams/:slug/discord', () => {
  it('owner GET lists the guild’s channels via the bot', async () => {
    const { owner, slug } = await seedOwnedTeam();
    await getDb().update(teams).set({ discordGuildId: 'g1' }).where(eq(teams.slug, slug));
    as(owner);
    const b = await (await getDiscord(body('GET'), params(slug))).json();
    expect(b.channels.map((c: any) => c.name)).toEqual(['general', 'reviews']);
  });
  it('non-owner is 403', async () => {
    const { slug } = await seedOwnedTeam();
    as(randomUUID());
    expect((await getDiscord(body('GET'), params(slug))).status).toBe(403);
  });
  it('PATCH sets the channel, and disconnect clears guild + channel', async () => {
    const { owner, slug } = await seedOwnedTeam();
    await getDb().update(teams).set({ discordGuildId: 'g1' }).where(eq(teams.slug, slug));
    as(owner);
    await patchDiscord(body('PATCH', { channelId: 'c2' }), params(slug));
    let [team] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(team.discordChannelId).toBe('c2');
    await patchDiscord(body('PATCH', { disconnect: true }), params(slug));
    [team] = await getDb().select().from(teams).where(eq(teams.slug, slug));
    expect(team.discordGuildId).toBeNull();
    expect(team.discordChannelId).toBeNull();
  });
});

describe('POST /api/teams/:slug/discord/test', () => {
  it('posts a test message to the configured channel (owner-only)', async () => {
    const { owner, slug } = await seedOwnedTeam();
    await getDb().update(teams).set({ discordGuildId: 'g1', discordChannelId: 'c2' }).where(eq(teams.slug, slug));
    as(owner);
    expect((await (await testPost(body('POST'), params(slug))).json()).ok).toBe(true);
    expect(vi.mocked(postToChannel)).toHaveBeenCalledWith('c2', expect.stringContaining('Squad'));
  });
  it('400s when no channel is configured', async () => {
    const { owner, slug } = await seedOwnedTeam();
    as(owner);
    expect((await testPost(body('POST'), params(slug))).status).toBe(400);
  });
});
