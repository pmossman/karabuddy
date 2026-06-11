// B124/P4: derive a SUGGESTED match result from recorded replays. Pure — the
// GET detail route gathers candidate rows and this maps them to a suggestion.
// Suggestions are computed on read, never stored, and NEVER auto-committed:
// a paired linked player or the organizer confirms one, which goes through
// the normal report endpoint with source 'replays'.
//
// Identity is account-based (B84): a replay "belongs" to an entrant when the
// entrant's userId is the uploader (replays.userId) or a linked participant
// (replay_participants, B112 double-sided). Only matches where BOTH entrants
// are account-linked get suggestions — guests are organizer-manual.
//
// Honest limitation (by design): when only one side recorded, the opponent's
// identity is inferred from the pairing context, not verified — the replay
// proves "entrant A played a game and won/lost", not WHO against. That's why
// suggestions require explicit confirmation.

export interface CandidateReplay {
  slug: string;
  createdAt: Date | string;
  uploaderUserId: string | null; // replays.userId
  participantUserIds: string[]; // replay_participants rows
  ownerPlayerId: string | null; // uploader's side in the payload
  altOwnerPlayerId: string | null; // linked participant's side (replay_alt_payload), if any
  winners: string[] | null; // winning playerIds; null/[] = no winner signal
  lobbyId: string | null; // stable across a Bo3 series
  sharedToTeam: boolean;
}

export interface SuggestedGame {
  winner: string | null; // entrantId
  replaySlug: string;
}

export interface ResultSuggestion {
  games: SuggestedGame[];
  score: string; // from entrant1's perspective, e.g. '2-1'
  confidence: 'high' | 'low';
}

interface LinkedEntrant {
  id: string;
  userId: string;
}

export function suggestResult(opts: {
  entrant1: LinkedEntrant;
  entrant2: LinkedEntrant;
  roundStartedAt: Date | string;
  replays: CandidateReplay[];
}): ResultSuggestion | null {
  const { entrant1, entrant2, replays } = opts;
  const roundStart = new Date(opts.roundStartedAt).getTime();
  const pairUsers = new Set([entrant1.userId, entrant2.userId]);

  interface GameSignal {
    slug: string;
    createdAt: number;
    lobbyKey: string;
    winner: string | null;
    conflicted: boolean;
  }
  const signals: GameSignal[] = [];

  for (const r of replays) {
    const createdAt = new Date(r.createdAt).getTime();
    if (!(createdAt >= roundStart)) continue;

    // Involvement: which paired entrants does this replay belong to?
    const involved = new Set<string>();
    if (r.uploaderUserId && pairUsers.has(r.uploaderUserId)) involved.add(r.uploaderUserId);
    for (const u of r.participantUserIds) if (pairUsers.has(u)) involved.add(u);
    if (involved.size === 0) continue;
    // Visible to the pairing context: shared to the team, or uploaded by one
    // of the paired entrants themselves.
    if (!r.sharedToTeam && !(r.uploaderUserId && pairUsers.has(r.uploaderUserId))) continue;

    // Map the winner signal to an entrant. The uploader's side is
    // ownerPlayerId; a linked participant's side is altOwnerPlayerId.
    const winnersArr = Array.isArray(r.winners) ? r.winners : null;
    let winner: string | null = null;
    let conflicted = false;
    if (winnersArr && winnersArr.length > 0) {
      const verdicts: string[] = [];
      const uploaderEntrant =
        r.uploaderUserId === entrant1.userId ? entrant1 : r.uploaderUserId === entrant2.userId ? entrant2 : null;
      if (uploaderEntrant && r.ownerPlayerId) {
        verdicts.push(winnersArr.includes(r.ownerPlayerId)
          ? uploaderEntrant.id
          : uploaderEntrant.id === entrant1.id ? entrant2.id : entrant1.id);
      }
      const altUser = r.participantUserIds.find((u) => pairUsers.has(u) && u !== r.uploaderUserId);
      const altEntrant = altUser === entrant1.userId ? entrant1 : altUser === entrant2.userId ? entrant2 : null;
      if (altEntrant && r.altOwnerPlayerId) {
        verdicts.push(winnersArr.includes(r.altOwnerPlayerId)
          ? altEntrant.id
          : altEntrant.id === entrant1.id ? entrant2.id : entrant1.id);
      }
      if (verdicts.length > 0) {
        const agreed = verdicts.every((v) => v === verdicts[0]);
        if (agreed) winner = verdicts[0];
        else conflicted = true; // double-sided recordings disagree
      }
    }

    signals.push({
      slug: r.slug,
      createdAt,
      lobbyKey: r.lobbyId || `__solo__${r.slug}`,
      winner,
      conflicted,
    });
  }

  if (signals.length === 0) return null;

  // A Bo3 series shares a lobbyId; pick the lobby group with the most games
  // (tie → most recent activity) and discard the rest — stray games from a
  // different session shouldn't pollute the score.
  const groups = new Map<string, GameSignal[]>();
  for (const s of signals) {
    const arr = groups.get(s.lobbyKey);
    if (arr) arr.push(s);
    else groups.set(s.lobbyKey, [s]);
  }
  let best: GameSignal[] | null = null;
  for (const group of groups.values()) {
    if (
      !best ||
      group.length > best.length ||
      (group.length === best.length &&
        Math.max(...group.map((g) => g.createdAt)) > Math.max(...best.map((g) => g.createdAt)))
    ) {
      best = group;
    }
  }
  if (!best) return null;

  best.sort((a, b) => a.createdAt - b.createdAt);
  const games = best.slice(0, 5).map((g) => ({ winner: g.conflicted ? null : g.winner, replaySlug: g.slug }));
  let w1 = 0, w2 = 0;
  for (const g of games) {
    if (g.winner === entrant1.id) w1++;
    else if (g.winner === entrant2.id) w2++;
  }
  const allDecisive = games.every((g) => g.winner !== null);
  return {
    games,
    score: `${w1}-${w2}`,
    confidence: allDecisive ? 'high' : 'low',
  };
}
