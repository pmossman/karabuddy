import { describe, expect, it } from 'vitest';
import { extractOpening, type OpeningFacts } from './openingExtract';

// Frame builders in the action-stops.test.ts style, but with real-ish cards.
// The recorder is Alice (p1) — her cards carry setIds; Bob's hand is masked
// (no setId), matching the decoder's masking invariant.
//
// The extractor is PILE-DRIVEN (hand identity decides keep vs mulligan); the
// game log is only a tiebreaker for captures that start mid-setup. Real prod
// captures often lack the recorder's own decision line entirely — two audited
// payloads (a keep with only the OPPONENT's line, and a mulligan with no
// setup log at all) are reproduced as the first two tests.

let uuidSeq = 0;
function card(set: string, num: number) {
  return { setId: { set, number: num }, name: `${set}_${num}`, uuid: `u${uuidSeq++}` };
}
const masked = () => ({ uuid: `m${uuidSeq++}` }); // opponent card: no setId
const maskedHand = () => Array.from({ length: 6 }, masked);

type Piles = { hand?: any[]; resources?: any[] };
function fr(
  phase: string,
  p1: Piles & { init?: boolean },
  p2: Piles & { init?: boolean } = {},
  msgs: any[] = [],
) {
  const player = (name: string, p: Piles & { init?: boolean }) => ({
    user: { username: name },
    hasInitiative: p.init === true,
    cardPiles: { hand: p.hand ?? [], resources: p.resources ?? [] },
  });
  return {
    t: 0,
    state: {
      phase,
      players: { p1: player('Alice', p1), p2: player('Bob', p2) },
      newMessages: msgs.map((m) => (typeof m === 'string' ? { message: [m] } : m)),
    },
  };
}

const decode = (frames: ReturnType<typeof fr>[], localPlayerId: string | null = 'p1') =>
  ({ frames, meta: { version: 2, localPlayerId } }) as any;

const ids = (cards: any[]) =>
  cards.map((c) => `${c.setId.set}_${String(c.setId.number).padStart(3, '0')}`);

// A standard 6-card dealt hand.
function deal() {
  return [card('SOR', 1), card('SOR', 2), card('SHD', 10), card('SHD', 10), card('TWI', 55), card('JTL', 200)];
}
function redeal() {
  return [card('SOR', 90), card('SOR', 91), card('SHD', 92), card('TWI', 93), card('JTL', 94), card('JTL', 95)];
}

describe('extractOpening', () => {
  it('extracts a KEEP from hand identity alone — recorder decision line missing (real-payload case)', () => {
    const hand = deal();
    const [r1, r2] = [hand[1], hand[4]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}, {}), // pre-deal: both hands empty (recording starts in the lobby)
      fr('setup', { hand, init: true }, { hand: maskedHand() }, ['Alice draws 6 cards in their starting hand']),
      fr('setup', { hand, init: true }, { hand: maskedHand() }, ['Bob will keep their hand']), // only the OPPONENT's line
      fr('setup', { hand: after, resources: [r1, r2], init: true }, { hand: maskedHand() }),
      fr('action', { hand: after, resources: [r1, r2], init: true }, { hand: Array(4).fill(0).map(masked), resources: [masked(), masked()] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o).not.toBeNull();
    expect(o.decision).toBe('keep');
    expect(o.recorderId).toBe('p1');
    expect(o.username).toBe('Alice');
    expect(o.dealtHand).toEqual(ids(hand));
    expect(o.keptHand).toEqual(ids(hand)); // keep: same hand at the resource prompt
    expect(o.resourced).toEqual(ids([r1, r2]));
    expect(o.mulliganFrameIndex).toBe(1); // the dealt-hand frame
    expect(o.resourceFrameIndex).toBe(3);
    expect(o.wentFirst).toBe(true);
  });

  it('extracts a MULLIGAN with NO log lines at all (real-payload case)', () => {
    const first = deal();
    const redrawn = redeal();
    const [r1, r2] = [redrawn[0], redrawn[3]];
    const after = redrawn.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}, { init: true }),
      fr('setup', { hand: first }, { hand: maskedHand(), init: true }),
      fr('setup', { hand: redrawn }, { hand: maskedHand(), init: true }),
      fr('setup', { hand: after, resources: [r1, r2] }, { hand: maskedHand(), init: true }),
      fr('action', { hand: after, resources: [r1, r2] }, { hand: Array(4).fill(0).map(masked), resources: [masked(), masked()] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.decision).toBe('mulligan');
    expect(o.dealtHand).toEqual(ids(first)); // the hand BEFORE the redraw
    expect(o.keptHand).toEqual(ids(redrawn));
    expect(o.resourced).toEqual(ids([r1, r2]));
    expect(o.mulliganFrameIndex).toBe(1);
    expect(o.wentFirst).toBe(false); // Bob held initiative
  });

  it('honors the FINAL state on undo-then-decide (mulligan undone, then keep)', () => {
    const hand = deal();
    const redrawn = redeal();
    const [r1, r2] = [hand[0], hand[5]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}),
      fr('setup', { hand }),
      fr('setup', { hand: redrawn }), // mulligan…
      fr('setup', { hand }), // …undone: original hand restored
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.decision).toBe('keep'); // kept hand IS the dealt hand (identity)
    expect(o.dealtHand).toEqual(ids(hand));
    expect(o.keptHand).toEqual(ids(hand));
  });

  it('honors an undo around the RESOURCE move (last transition wins)', () => {
    const hand = deal();
    const [a1, a2] = [hand[0], hand[1]];
    const [b1, b2] = [hand[2], hand[3]];
    const afterA = hand.filter((c) => c !== a1 && c !== a2);
    const afterB = hand.filter((c) => c !== b1 && c !== b2);
    const frames = [
      fr('setup', {}),
      fr('setup', { hand }),
      fr('setup', { hand: afterA, resources: [a1, a2] }), // first pick…
      fr('setup', { hand }), // …undone
      fr('setup', { hand: afterB, resources: [b1, b2] }), // re-picked
      fr('action', { hand: afterB, resources: [b1, b2] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.resourced).toEqual(ids([b1, b2]));
    expect(o.resourceFrameIndex).toBe(4);
  });

  it('keeps duplicate copies as a multiset', () => {
    const hand = deal(); // contains 2x SHD_010
    const [r1, r2] = [hand[2], hand[4]]; // one SHD_010 + TWI_055
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}),
      fr('setup', { hand }),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.dealtHand.filter((id) => id === 'SHD_010')).toHaveLength(2);
    expect(o.resourced).toEqual(['SHD_010', 'TWI_055']);
    // keptHand is the hand AT the resource prompt — both copies still in it.
    expect(o.keptHand.filter((id) => id === 'SHD_010')).toHaveLength(2);
  });

  it('returns null when the recording started mid-game (no setup frames)', () => {
    const frames = [
      fr('action', { hand: deal(), resources: [card('SOR', 1), card('SOR', 2)] }),
      fr('action', { hand: deal() }),
    ];
    expect(extractOpening(decode(frames))).toBeNull();
  });

  it('returns null when setup never completes (no action frame)', () => {
    const frames = [fr('setup', {}), fr('setup', { hand: deal() })];
    expect(extractOpening(decode(frames))).toBeNull();
  });

  it('returns null on an AMBIGUOUS mid-setup start (no pre-deal frame, no log)', () => {
    // First captured frame already has a full hand: could be a keep, could be
    // a capture that started after a mulligan's redraw. No log → conservative.
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', { hand }),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    expect(extractOpening(decode(frames))).toBeNull();
  });

  it('breaks the mid-setup-start tie with the recorder\'s KEEP log line', () => {
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', { hand }),
      fr('setup', { hand }, {}, [{ message: [{ type: 'player', name: 'Alice' }, ' will keep their hand'] }]),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.decision).toBe('keep');
    expect(o.dealtHand).toEqual(ids(hand));
  });

  it('mid-setup-start tie: the OPPONENT\'s keep line does not break it', () => {
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', { hand }),
      fr('setup', { hand }, {}, ['Bob will keep their hand']),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    expect(extractOpening(decode(frames))).toBeNull();
  });

  it('mid-setup-start with a RECORDER mulligan line stays null (dealt hand unknowable)', () => {
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      // Capture began between the mulligan click and the redraw: the only
      // full hand we ever see is the REDRAWN one.
      fr('setup', { hand }, {}, ['Alice will mulligan']),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    expect(extractOpening(decode(frames))).toBeNull();
  });

  it('mid-setup start still yields a MULLIGAN when the pre-mulligan hand was captured', () => {
    // No pre-deal frame, but the first full hand differs from the kept hand —
    // identity alone proves the mulligan.
    const first = deal();
    const redrawn = redeal();
    const [r1, r2] = [redrawn[0], redrawn[1]];
    const after = redrawn.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', { hand: first }),
      fr('setup', { hand: redrawn }),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.decision).toBe('mulligan');
    expect(o.dealtHand).toEqual(ids(first));
  });

  it('delta-matches CUMULATIVE logs in the tiebreak path', () => {
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const bobLine = 'Bob will keep their hand';
    const aliceLine = 'Alice will keep their hand';
    const frames = [
      fr('setup', { hand }, {}, [bobLine]),
      fr('setup', { hand }, {}, [bobLine, aliceLine]), // cumulative: Alice's line is the delta
      fr('setup', { hand: after, resources: [r1, r2] }, {}, [bobLine, aliceLine]),
      fr('action', { hand: after, resources: [r1, r2] }, {}, [bobLine, aliceLine]),
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.decision).toBe('keep');
  });

  it('falls back to inferring the recorder when meta.localPlayerId is absent', () => {
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}, {}),
      fr('setup', { hand }, { hand: maskedHand() }),
      fr('setup', { hand: after, resources: [r1, r2] }, { hand: maskedHand() }),
      fr('action', { hand: after, resources: [r1, r2] }, { hand: Array(4).fill(0).map(masked), resources: [masked(), masked()] }),
    ];
    const o = extractOpening(decode(frames, null)) as OpeningFacts;
    expect(o.recorderId).toBe('p1'); // only Alice's hand has real setIds
  });

  it('reports wentFirst=null when initiative is never visible through the transition', () => {
    // The scan includes the first action frame (the transition can carry the
    // resource move) — so "never visible" means absent there too.
    const hand = deal();
    const [r1, r2] = [hand[0], hand[1]];
    const after = hand.filter((c) => c !== r1 && c !== r2);
    const frames = [
      fr('setup', {}),
      fr('setup', { hand }),
      fr('setup', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2] }),
      fr('action', { hand: after, resources: [r1, r2], init: true }), // beyond the scan
    ];
    const o = extractOpening(decode(frames)) as OpeningFacts;
    expect(o.wentFirst).toBeNull();
  });
});
