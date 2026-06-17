import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { Metadata } from 'next';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { replays, replayAltPayload, tags } from '@/lib/schema';
import { segmentMatches } from '@/lib/seriesGrouping';
import { orderPlayersOwnerFirst } from '@/lib/players';
import { isSampleReplaySlug } from '@/lib/sampleReplays';
import { anonymizePlayersSummary } from '@/lib/anonymizeReplay';
import { userHasLinkedExtension } from '@/lib/userResolution';
import { auth } from '@/auth';
import { canViewAltPerspective, canViewReplayIdentities } from '@/lib/altPerspective';
import { verifyMoment } from '@/lib/shareToken';
import { ReplayViewer } from './ReplayViewer';
import { sideboardDiff } from '@/lib/sideboardDiff';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Cached per request render — generateMetadata + the page share ONE query.
const loadReplay = cache(async (slug: string) => {
  const [row] = await getDb().select().from(replays).where(eq(replays.slug, slug)).limit(1);
  return row ?? null;
});

// B129/B158: the games of this replay's MATCH (same match.lobbyId), in play
// order. A karabast lobby can hold many matches, and (B158 p2) opponents now have
// their OWN separate rows in the same lobby — so we (a) keep only the games
// recorded by THIS replay's side (its owner + the alt recorder — the two people
// who recorded it), then (b) segment by format into matches and take the one
// containing this replay. Cached so generateMetadata + the page share the query.
// Entitlement-gated by the caller (anonymized viewers never get the sibling slugs).
const loadLobbyForSeries = cache(async (lobbyId: string) => {
  const reps = await getDb()
    .select({
      slug: replays.slug,
      createdAt: replays.createdAt,
      userId: replays.userId,
      ownerToken: replays.ownerToken,
      winners: replays.winners,
      ownerPlayerId: replays.ownerPlayerId,
      decks: replays.decks,
      fmt: sql<string | null>`${replays.match}->>'gamesToWinMode'`,
    })
    .from(replays)
    .where(sql`${replays.match}->>'lobbyId' = ${lobbyId}`)
    .orderBy(asc(replays.createdAt));
  const slugs = reps.map((r) => r.slug);
  const alts = slugs.length
    ? await getDb()
        .select({ slug: replayAltPayload.replaySlug, altUserId: replayAltPayload.altUserId })
        .from(replayAltPayload)
        .where(inArray(replayAltPayload.replaySlug, slugs))
    : [];
  const altBySlug = new Map(alts.map((a) => [a.slug, a.altUserId]));
  return reps.map((r) => ({ ...r, altUserId: altBySlug.get(r.slug) ?? null }));
});

type LobbyGame = Awaited<ReturnType<typeof loadLobbyForSeries>>[number];

// The games of the SAME match as `currentSlug`, in play order — scoped to this
// replay's side (owner + alt recorder) and segmented out of the rest of the lobby.
function currentMatchGames(all: LobbyGame[], currentSlug: string): LobbyGame[] {
  const current = all.find((g) => g.slug === currentSlug);
  if (!current) return [];
  const idOf = (g: LobbyGame) => g.userId ?? `tok:${g.ownerToken}`;
  const recorders = new Set<string>([idOf(current)]);
  if (current.altUserId) recorders.add(current.altUserId);
  const mine = all.filter((g) => recorders.has(idOf(g)) || (g.altUserId != null && recorders.has(g.altUserId)));
  const wonOf = (g: LobbyGame) => {
    const w = Array.isArray(g.winners) ? (g.winners as string[]) : null;
    if (!w || !g.ownerPlayerId) return null;
    return w.includes(g.ownerPlayerId);
  };
  const matches = segmentMatches(mine, wonOf, current.fmt);
  return matches.find((m) => m.some((g) => g.slug === currentSlug)) ?? mine;
}

async function seriesFor(row: { slug: string; match: unknown }, anonymize: boolean) {
  const lobbyId = (row.match as any)?.lobbyId;
  if (anonymize || typeof lobbyId !== 'string' || !lobbyId) return null;
  const match = currentMatchGames(await loadLobbyForSeries(lobbyId), row.slug);
  if (match.length < 2) return null;
  const games = match.map((g, i) => ({ slug: g.slug, gameNumber: i + 1 }));
  const current = games.find((g) => g.slug === row.slug)?.gameNumber;
  if (!current) return null;
  return { current, games };
}

// B150: sideboard changes from the PREVIOUS game IN THIS MATCH (same opponent,
// same series — B158: not just the previous row in the lobby, which could now be
// an opponent's separate recording or a different match). Per player, the deck
// diff (cards in/out). Exact for the recording player; the opponent's deck is
// masked so they don't appear. Entitlement-gated like series nav.
async function loadSideboardChanges(row: { slug: string; match: unknown; decks: unknown }, anonymize: boolean) {
  const lobbyId = (row.match as any)?.lobbyId;
  if (anonymize || typeof lobbyId !== 'string' || !lobbyId) return null;
  const match = currentMatchGames(await loadLobbyForSeries(lobbyId), row.slug);
  const idx = match.findIndex((g) => g.slug === row.slug);
  if (idx < 1) return null; // first game of THIS match → nothing to diff against
  const prevDecks = (match[idx - 1].decks as any) || {};
  const curDecks = (row.decks as any) || {};

  const players = [];
  for (const pid of Object.keys(curDecks)) {
    const cur = curDecks[pid], prev = prevDecks[pid];
    if (!prev) continue;
    const diff = sideboardDiff(prev.deck ?? null, cur.deck ?? null);
    if (!diff) continue; // a deck is masked one/both games
    players.push({
      playerId: pid,
      username: cur.username ?? prev.username ?? null,
      leader: cur.leader ?? null,
      in: diff.in,
      out: diff.out,
      changed: diff.changed,
    });
  }
  if (players.length === 0) return null;
  return { fromGameNumber: idx, players };
}

// B113: per-frame Open Graph so a shared `?f=` link unfurls into the moment card
// (the image is generated by /api/replays/[slug]/og-image). Title = matchup; the
// optional `?t=` signed token surfaces a tag in the description; samples stay
// anonymized.
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const f = typeof sp.f === 'string' ? sp.f : undefined;
  const t = typeof sp.t === 'string' ? sp.t : undefined;

  const row = await loadReplay(slug);
  if (!row) return { title: 'KaraBuddy' };

  // B122: only the uploader / a teammate sees real karabast handles. Everyone
  // else (incl. anonymous link visitors + crawlers) gets the leader matchup. A
  // user-set displayName is always safe to show (it's user-chosen).
  const session = await auth();
  const viewerUserId = (session?.user as any)?.id ?? null;
  // B129: a curated sample (B107) is anonymized for the PUBLIC, not for the
  // uploader/teammates — an entitled viewer keeps identities (and series nav)
  // on their own replay even while it's featured.
  const anonymize = !(await canViewReplayIdentities(row, { sessionUserId: viewerUserId, installToken: null }));
  const ordered = orderPlayersOwnerFirst(row.players, row.ownerPlayerId) as any[];
  const nameOf = (p: any) => (p?.username ?? 'Player') + (p?.leader?.name ? ` (${p.leader.name})` : '');
  const leaderMatchup = `${ordered[0]?.leader?.name ?? 'Unknown'} vs ${ordered[1]?.leader?.name ?? 'Unknown'}`;
  // B129: auto titles carry the game number when the replay is part of a
  // recorded series (a user-set displayName stays untouched).
  const series = await seriesFor(row, anonymize);
  const gameSuffix = series ? ` — Game ${series.current}` : '';
  const matchup = (row as any).displayName
    ? (row as any).displayName
    : (anonymize ? leaderMatchup : `${nameOf(ordered[0])} vs ${nameOf(ordered[1])}`) + gameSuffix;

  // Opt-in tag in the description (B113 signed token; never for samples, but OK
  // for an anonymized viewer — the sharer explicitly authorized this tag).
  let tagLine: string | null = null;
  if (t && !isSampleReplaySlug(slug)) {
    const frameIndex = Math.max(0, (parseInt(f || '1', 10) || 1) - 1);
    const claim = verifyMoment(t);
    if (claim && claim.slug === slug && claim.frameIndex === frameIndex) {
      const [tag] = await getDb().select().from(tags).where(eq(tags.id, claim.tagId)).limit(1);
      if (tag && tag.replaySlug === slug && tag.frameIndex === frameIndex && tag.comment) tagLine = tag.comment;
    }
  }
  const frameLabel = f ? `frame ${parseInt(f, 10) || 1}` : 'the start';
  const description = tagLine ? `“${tagLine.slice(0, 180)}”` : `${matchup} — Star Wars Unlimited replay at ${frameLabel}.`;
  const image = `/api/replays/${slug}/og-image?f=${encodeURIComponent(f ?? '')}&t=${encodeURIComponent(t ?? '')}`;

  return {
    title: `${matchup} · KaraBuddy`,
    description,
    openGraph: { title: matchup, description, type: 'website', images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title: matchup, description, images: [image] },
  };
}

export default async function ReplayPage({ params }: PageProps) {
  const { slug } = await params;
  const row = await loadReplay(slug);
  if (!row) notFound();

  // Serialize timestamps for client transport. Owner-first player order
  // (B59-followup) so the sidebar matchup + default title both read
  // "<me> vs <them>" instead of being order-dependent on the raw jsonb
  // key sort.
  const players = orderPlayersOwnerFirst(row.players, row.ownerPlayerId);

  // B122: real karabast handles + deck lists are visible ONLY to the uploader
  // or a teammate of the uploader. Everyone else (anonymous link visitors, other
  // players) gets "Player N" handles, the leader-matchup title, and no full deck
  // lists (the viewer still derives "seen" cards from the frames). Order is
  // preserved so labels line up. B129: a curated sample (B107) anonymizes the
  // same way — by entitlement — so featuring a replay doesn't blind its own
  // uploader/teammates (the public is unentitled and stays anonymized).
  const session = await auth();
  const viewerUserId = (session?.user as any)?.id ?? null;
  const anonymize = !(await canViewReplayIdentities(row, { sessionUserId: viewerUserId, installToken: null }));

  // B112: Flip control only for a viewer entitled to the 2nd perspective.
  const canFlip = !anonymize && (await canViewAltPerspective(slug, viewerUserId));

  // B121-followup: suppress the install banner for a signed-in viewer who already
  // has a linked extension (the viewer has no global header, so it's gated here).
  const hasLinkedExtension = await userHasLinkedExtension(viewerUserId);

  // B129: series hop + "Game N" title for the games of the same Bo3.
  const series = await seriesFor(row, anonymize);
  // B150: sideboard changes from the previous game (entitled viewers only).
  const sideboard = await loadSideboardChanges({ slug: row.slug, match: row.match, decks: (row as any).decks }, anonymize);

  const replay = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    players: anonymize ? anonymizePlayersSummary(players as any[]) : players,
    // A user-set title is always shown (it's user-chosen — never a leaked karabast
    // handle); only the AUTO default differs (leader matchup for anon viewers).
    // Full deck lists are dropped for unauthorized viewers (uploader/teammate-only)
    // — the DecksModal shows only the "seen" cards instead.
    displayName: (row as any).displayName,
    decks: anonymize ? null : (row as any).decks,
  };

  // B71: tags are no longer SSR'd — the viewer fetches them from
  // GET /api/replays/[slug]/tags so the server can scope them to the
  // viewer (own + team-scoped only). SSR'ing all tags would leak other
  // teams' / others' personal comments into the initial HTML.
  return <ReplayViewer replay={replay} initialTags={[]} anonymize={anonymize} canFlip={canFlip} hasLinkedExtension={hasLinkedExtension} series={series} sideboard={sideboard} publicComments={!!(row as any).publicAt} />;
}
