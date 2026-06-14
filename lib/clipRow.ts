// B142: one serializer for a clip-browser row — used by the clip list APIs
// (`/api/me/clips`, `/api/teams/[slug]/clips`) and, via them, the `/clips`
// browser. A clip carries no matchup of its own, so the row is the parent
// replay's matchup (leaders/bases/players, owner-first, perspective = the
// uploader) PLUS the clip's own fields. Identities anonymize per the parent
// replay's visibility (same rule as the clip viewer), so a clip on a replay you
// aren't entitled to still shows the public deck matchup but Player1/Player2.
import { serializeReplayRow, type LeaderRef } from './replayRow';
import { anonymizePlayersSummary } from './anonymizeReplay';

export interface SerializedClipRow {
  clipSlug: string;
  replaySlug: string;
  title: string | null;
  startFrame: number;
  endFrame: number;
  frameCount: number;
  clipCreatedAt: string;
  // The clip's author display name (null when anonymized or anonymous creator).
  creatorName: string | null;
  // The viewer created this clip.
  isMine: boolean;
  // The viewer can delete it (creator or parent-replay owner).
  canDelete: boolean;
  // Parent-replay matchup (anonymized when the viewer isn't entitled).
  players: any[];
  match: any;
  ownerPlayerId: string | null;
  viewerPlayerId: string | null;
  ownLeader: LeaderRef | null;
  oppLeader: LeaderRef | null;
  replayDisplayName: string | null;
}

export function serializeClipRow(
  clip: { slug: string; replaySlug: string; startFrame: number; endFrame: number; title: string | null; createdAt: Date | string },
  replay: any,
  opts: { anonymize: boolean; creatorName: string | null; isMine: boolean; canDelete: boolean },
): SerializedClipRow {
  // Reuse the replay serializer for the matchup; perspective = the uploader's
  // canonical side (like the team grid), so "my leader" filters key off it.
  const base = serializeReplayRow(replay, { ownerName: null, viewerPlayerId: replay.ownerPlayerId ?? null });
  const anon = opts.anonymize;
  return {
    clipSlug: clip.slug,
    replaySlug: clip.replaySlug,
    title: clip.title ?? null,
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
    frameCount: clip.endFrame - clip.startFrame + 1,
    clipCreatedAt: clip.createdAt instanceof Date ? clip.createdAt.toISOString() : String(clip.createdAt),
    creatorName: anon ? null : opts.creatorName,
    isMine: opts.isMine,
    canDelete: opts.canDelete,
    players: anon ? anonymizePlayersSummary(base.players) : base.players,
    match: base.match,
    ownerPlayerId: anon ? null : base.ownerPlayerId,
    viewerPlayerId: anon ? null : base.viewerPlayerId,
    ownLeader: base.ownLeader,
    oppLeader: base.oppLeader,
    // A user-set display name can leak identity ("Parker's Vader") — drop it
    // when anonymized; the leader/base matchup stays (public info).
    replayDisplayName: anon ? null : base.displayName,
  };
}
