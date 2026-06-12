// B128 (v2 — "both hands face up"): a double-sided replay carries BOTH
// recordings, and each recording has its OWN player's hidden zones unmasked
// (hand + face-down resources). Instead of flipping the board between seats,
// merge: take the shown timeline and substitute the opponent's hidden zones
// with the unmasked versions from the OTHER recording's equivalent frame
// (board-signature mapping — card uuids are randomized per viewer by karabast
// for hidden zones, so a uuid join is impossible; temporal mapping is the
// join).
//
// Pure + one-shot: compute an enriched frame array once per (shown, other)
// pair and render from it. The substituted cards are stripped of any
// interaction flags so the lifted board treats them as plain display.

import type { CollapsedReplay, Frame } from '@/lib/replayDecoder';
import { mapFrameIndex } from '@/lib/replaySignature';

// The zones karabast masks for the non-local player. The pile viewer + board
// pick the revealed versions up automatically once substituted.
const HIDDEN_ZONES = ['hand', 'resources'] as const;

export function revealHiddenHand(shown: CollapsedReplay, other: CollapsedReplay): Frame[] {
  const otherLocal = other.meta.localPlayerId; // the seat whose zones are hidden in `shown`
  if (!otherLocal) return shown.frames;

  return shown.frames.map((f, i) => {
    const players = f.state?.players;
    const target = players?.[otherLocal];
    if (!target?.cardPiles) return f;

    const mapped = mapFrameIndex(shown.frames, i, other.frames);
    const openPiles = other.frames[mapped]?.state?.players?.[otherLocal]?.cardPiles;
    if (!openPiles) return f;

    const substituted: Record<string, unknown> = { ...target.cardPiles };
    let changed = false;
    for (const zone of HIDDEN_ZONES) {
      const revealed = openPiles[zone];
      if (!Array.isArray(revealed)) continue;
      substituted[zone] = revealed.map((c: any) => ({ ...c, selectable: false, selected: false }));
      changed = true;
    }
    if (!changed) return f;

    return {
      ...f,
      state: {
        ...f.state,
        players: {
          ...players,
          [otherLocal]: { ...target, cardPiles: substituted },
        },
      },
    };
  });
}
