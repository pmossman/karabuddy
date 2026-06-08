// B112: hand-INDEPENDENT frame signature, used to "land on the same moment" when
// flipping a double-sided replay between the two players' recordings.
//
// The two recordings are of the SAME karabast game but are separate streams with
// different frame counts (refreshes, periodic snapshots, late start). To map a
// frame in one to the equivalent frame in the other we hash only the PUBLIC board
// state both recordings agree on — explicitly EXCLUDING each player's hand, deck,
// and resource CONTENTS (those are masked differently per perspective, so
// including them guarantees a miss). Pure → unit-tested.

interface FrameLike { state: any }

// A board card reduced to the fields both recordings share for the same card:
// its stable uuid, current damage, ready/exhausted, and attached upgrade uuids.
// POV-specific fields (selectable, selectableZones, controller-relative flags)
// are deliberately dropped.
function publicCard(c: any): any {
  return {
    u: c?.uuid ?? null,
    d: c?.damage ?? 0,
    e: c?.exhausted ? 1 : 0,
    up: Array.isArray(c?.upgrades) ? c.upgrades.map((x: any) => x?.uuid ?? null).sort() : [],
  };
}

export function frameSignature(state: any): string {
  const players = state?.players || {};
  const per = Object.keys(players)
    .sort()
    .map((pid) => {
      const p = players[pid] || {};
      const piles = p.cardPiles || {};
      const zone = (z: string) =>
        (Array.isArray(piles[z]) ? piles[z] : [])
          .map(publicCard)
          .sort((a: any, b: any) => String(a.u).localeCompare(String(b.u)));
      return {
        id: pid,
        ground: zone('groundArena'),
        space: zone('spaceArena'),
        // discard contents are public, but counts are enough to discriminate
        // moments and are cheaper + robust to ordering differences.
        discard: Array.isArray(piles.discard) ? piles.discard.length : 0,
        resources: Array.isArray(piles.resources) ? piles.resources.length : 0,
        base: { d: p.base?.damage ?? 0 },
        leader: { z: p.leader?.zone ?? null, d: p.leader?.damage ?? 0, dep: p.leader?.deployed ?? null },
        active: !!p.isActionPhaseActivePlayer,
      };
    });
  return JSON.stringify({ phase: state?.phase ?? null, round: state?.roundNumber ?? null, per });
}

const frac = (i: number, len: number) => (len > 1 ? i / (len - 1) : 0);

// Map `fromIndex` in `fromFrames` to the equivalent index in `toFrames`: prefer a
// frame with the SAME public signature (nearest in proportional position if there
// are several); else fall back to proportional. Pure.
export function mapFrameIndex(fromFrames: FrameLike[], fromIndex: number, toFrames: FrameLike[]): number {
  if (!toFrames || toFrames.length === 0) return 0;
  if (!fromFrames || fromFrames.length === 0) return 0;
  const clamped = Math.max(0, Math.min(fromFrames.length - 1, fromIndex));
  const sig = frameSignature(fromFrames[clamped]?.state);
  const target = frac(clamped, fromFrames.length);

  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < toFrames.length; i++) {
    if (frameSignature(toFrames[i]?.state) !== sig) continue;
    const d = Math.abs(frac(i, toFrames.length) - target);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0) return best;

  return Math.round(target * (toFrames.length - 1));
}
