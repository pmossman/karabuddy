// B106: "jump to a moment" chapter detection for the replay viewer. Pure
// derivation from the decoded (collapsed) frames — frameIndex values are in the
// same collapsed space the viewer steps in, so they feed jumpTo() directly.
//
// Chapters are the structural beats of a game you'd want to skip to without
// scrubbing: each round's start, each leader's deploy ("flip"), and the start /
// end of the game. Tags are merged in by the caller (they live in component
// state), so this stays a pure function of the frames.

export type ChapterKind = 'start' | 'round' | 'leader' | 'end' | 'tag';

export interface Chapter {
  frameIndex: number;
  kind: ChapterKind;
  label: string;
  sublabel?: string;
}

const leaderIsDeployed = (leader: any): boolean =>
  // Mirrors karabast's own check (LeaderBaseCard): a leader carries a `zone`
  // once deployed, and it's anything but its home 'base' slot.
  !!leader && typeof leader === 'object' && 'zone' in leader && leader.zone !== 'base';

export function computeChapters(frames: ReadonlyArray<{ state: any }> | null): Chapter[] {
  if (!frames || frames.length === 0) return [];
  const chapters: Chapter[] = [{ frameIndex: 0, kind: 'start', label: 'Game start' }];

  let prevPhase: string | null = null;
  let roundNum = 0;
  const deployed = new Set<string>();

  frames.forEach((f, i) => {
    const st = f?.state;
    const players = st?.players;
    if (!players || typeof players !== 'object') return;
    const phase: string | null = typeof st.phase === 'string' ? st.phase : null;

    // A round's action phase beginning = a new round. The first action phase
    // (prevPhase is setup/null) is Round 1. Skip a marker that would land on
    // frame 0 (it'd duplicate "Game start").
    if (phase === 'action' && prevPhase !== 'action') {
      roundNum += 1;
      if (i > 0) chapters.push({ frameIndex: i, kind: 'round', label: `Round ${roundNum}` });
    }

    // First frame a player's leader appears deployed = its flip.
    for (const pid of Object.keys(players)) {
      if (deployed.has(pid)) continue;
      const leader = players[pid]?.leader;
      if (leaderIsDeployed(leader)) {
        deployed.add(pid);
        const name = (typeof leader.name === 'string' && leader.name) || 'Leader';
        const who = players[pid]?.user?.username;
        chapters.push({ frameIndex: i, kind: 'leader', label: `${name} deploys`, sublabel: who || undefined });
      }
    }

    prevPhase = phase;
  });

  chapters.push({ frameIndex: frames.length - 1, kind: 'end', label: 'Game end' });

  // Stable sort by frame; ties keep insertion order (start < round < leader <
  // end at the same frame), which reads naturally.
  return chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.frameIndex - b.c.frameIndex || a.i - b.i)
    .map(({ c }) => c);
}
