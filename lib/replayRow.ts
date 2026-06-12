// B116: one serializer for the replay-browser row, used by BOTH the personal
// library (RSC `app/(app)/replays/page.tsx`) and the team grid
// (`app/api/teams/[slug]/replays/route.ts`). Previously each site hand-rolled
// the shape (and the team route leaked every column via `...replay`); this is
// the single source of truth for the wire shape `ReplayFilters` consumes.
//
// The key concept is PERSPECTIVE: `viewerPlayerId` is "which side is *mine* for
// this row". The personal library resolves it to the VIEWER (me — owner if I'm
// the canonical recorder, else the alt recorder's side for a double-sided
// replay I recorded as player 2). The team grid resolves it to the UPLOADER
// (the canonical owner). From it we derive `ownLeader` / `oppLeader` so the
// "my leader" / "opponent leader" filters and the matchup display key off the
// right side. Null perspective (pre-B59, anonymous, unknown) → both null; the
// leader filters simply won't match those rows.
import { orderPlayersOwnerFirst } from './players';

export interface LeaderRef {
  name?: string | null;
  set?: string | null;
  number?: number | null;
}

export interface SerializedReplayRow {
  slug: string;
  gameId: string;
  userId: string | null;
  players: any[];
  durationMs: number;
  actionCount: number;
  createdAt: string;
  match: any;
  displayName: string | null;
  labels: string[] | null;
  winners: string[] | null;
  ownerPlayerId: string | null;
  ownerName: string | null;
  // Perspective: the playerId that is "own" for this row + the resolved
  // leaders. Null when the perspective player can't be determined.
  viewerPlayerId: string | null;
  ownLeader: LeaderRef | null;
  oppLeader: LeaderRef | null;
  // B116: stable across a Bo3's games (the lobby persists); drives series
  // grouping in the browser. Null on pre-B42 / quick rows without a lobby.
  lobbyId: string | null;
  // Context-dependent extras — only present when the caller supplies them.
  sharedTeams?: { slug: string; name: string }[];
  commentCount?: number;
  internal?: boolean;
  isMine?: boolean;
  // B128: both players' recordings exist (replay_alt_payload row) — the viewer
  // can show both hands face up / flip seats.
  doubleSided?: boolean;
}

export function serializeReplayRow(
  replay: any,
  opts: {
    ownerName: string | null;
    // "Own" side for this row's perspective (viewer for the library, uploader
    // for the team grid). Null → leaders unresolved.
    viewerPlayerId: string | null;
    sharedTeams?: { slug: string; name: string }[];
    commentCount?: number;
    internal?: boolean;
    isMine?: boolean;
    doubleSided?: boolean;
  },
): SerializedReplayRow {
  // Order owner-first off the CANONICAL ownerPlayerId (not the viewer) so
  // "owner vs opponent" rendering + the existing "owner rendered first" stays
  // stable; perspective only affects ownLeader/oppLeader resolution below.
  const players = orderPlayersOwnerFirst(replay.players, replay.ownerPlayerId) as any[];
  const vid = opts.viewerPlayerId;
  const own = vid ? players.find((p) => p?.id === vid) : null;
  const opp = vid ? players.find((p) => p?.id !== vid) : null;
  const match = replay.match ?? null;

  const out: SerializedReplayRow = {
    slug: replay.slug,
    gameId: replay.gameId,
    userId: replay.userId ?? null,
    players,
    durationMs: replay.durationMs ?? 0,
    actionCount: replay.actionCount ?? 0,
    createdAt: replay.createdAt instanceof Date ? replay.createdAt.toISOString() : String(replay.createdAt),
    match,
    displayName: replay.displayName ?? null,
    labels: replay.labels ?? null,
    winners: replay.winners ?? null,
    ownerPlayerId: replay.ownerPlayerId ?? null,
    ownerName: opts.ownerName ?? null,
    viewerPlayerId: vid ?? null,
    ownLeader: own?.leader ?? null,
    oppLeader: opp?.leader ?? null,
    lobbyId: (match && typeof match.lobbyId === 'string' && match.lobbyId) ? match.lobbyId : null,
  };
  if (opts.sharedTeams !== undefined) out.sharedTeams = opts.sharedTeams;
  if (opts.commentCount !== undefined) out.commentCount = opts.commentCount;
  if (opts.internal !== undefined) out.internal = opts.internal;
  if (opts.isMine !== undefined) out.isMine = opts.isMine;
  if (opts.doubleSided !== undefined) out.doubleSided = opts.doubleSided;
  return out;
}
