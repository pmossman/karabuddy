// B113: pure builder for the shareable "moment card" (the OG unfurl image). Turns
// a decoded replay + a frame index into a flat, serializable model the Satori
// renderer draws — no JSX, no DOM, no network, so all the logic (frame pick, POV
// resolution, anonymization, card-art URLs, tag truncation) is unit-testable.
import { HIDDEN_SET, type DecodedReplay } from './replayDecoder';

const S3 = 'https://karabast-data.s3.amazonaws.com/';
export const CARDBACK = `${S3}game/swu-cardback.webp`;
const TOKEN_IDS = new Set(['3941784506', '3463348370', '7268926664', '9415311381', '8752877738', '2007868442', '6665455613']);
const MAX_UNITS_PER_ARENA = 5; // keep the card readable; overflow noted via `extra*`
const TAG_MAX = 140;

export interface CardArt { artUrl: string; name: string; damage: number }
export interface UnitModel { artUrl: string; name: string; power: number | null; hp: number | null; damage: number; exhausted: boolean }
export interface SideModel {
  name: string;
  leader: CardArt | null;
  base: CardArt | null;
  ground: UnitModel[];
  space: UnitModel[];
  extraGround: number;
  extraSpace: number;
  availableResources: number;
  handCount: number;
}
export interface MomentCardModel {
  matchup: { top: SideModel; bottom: SideModel };
  roundLabel: string;
  frameLabel: string;
  tagLine: string | null;
}

// Mirror of s3CardImageURL (app/_utils/s3Utils.ts) for the card objects that live
// in a decoded frame's gamestate — kept here so this module has no client deps.
export function cardArtUrl(card: any): string {
  if (!card) return CARDBACK;
  const set = card.setId?.set;
  const number = card.setId?.number;
  const type: string | undefined = card.type;
  if (typeof type === 'string' && type.includes('token') && card.id) {
    return `${S3}cards/_tokens/en/standard/${card.id}.webp`;
  }
  if (!card.id && (TOKEN_IDS.has(String(card.id)))) {
    return `${S3}cards/_tokens/en/standard/${card.id}.webp`;
  }
  if (!set || number == null || set === HIDDEN_SET) return CARDBACK;
  let n = String(number).padStart(3, '0');
  // Only an UNDEPLOYED leader (sitting at its base) uses the `-base` leader-side
  // art; a deployed leader uses its plain unit art, and a base card is plain too.
  if (type === 'leader' && card.zone === 'base') n += '-base';
  if (type === 'leader' && card.onStartingSide === false) n += '2';
  return `${S3}cards/${set}/en/standard/large/${n}.webp?v=3`;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s);

// A real unit on the board (basicUnit / leaderUnit / tokenUnit) — excludes
// non-unit tokens that also sit in an arena (e.g. a "Shield" tokenUpgrade).
const isUnit = (c: any) => /unit/i.test(String(c?.type ?? c?.printedType ?? ''));

const toUnit = (u: any): UnitModel => ({
  artUrl: cardArtUrl(u),
  name: u.name ?? '',
  power: typeof u.power === 'number' ? u.power : null,
  hp: typeof u.hp === 'number' ? u.hp : null,
  damage: u.damage ?? 0,
  exhausted: !!u.exhausted,
});

function buildSide(player: any, name: string): SideModel {
  const piles = player?.cardPiles ?? {};
  const arena = (pile: any[]) => (pile ?? []).filter((c: any) => c && c.setId && isUnit(c));
  const groundAll = arena(piles.groundArena);
  const spaceAll = arena(piles.spaceArena);
  return {
    name,
    leader: player?.leader?.setId ? { artUrl: cardArtUrl(player.leader), name: player.leader.name ?? '', damage: player.leader.damage ?? 0 } : null,
    base: player?.base?.setId ? { artUrl: cardArtUrl(player.base), name: player.base.name ?? '', damage: player.base.damage ?? 0 } : null,
    ground: groundAll.slice(0, MAX_UNITS_PER_ARENA).map(toUnit),
    space: spaceAll.slice(0, MAX_UNITS_PER_ARENA).map(toUnit),
    extraGround: Math.max(0, groundAll.length - MAX_UNITS_PER_ARENA),
    extraSpace: Math.max(0, spaceAll.length - MAX_UNITS_PER_ARENA),
    availableResources: typeof player?.availableResources === 'number' ? player.availableResources : (piles.resources?.length ?? 0),
    handCount: piles.hand?.length ?? 0,
  };
}

export function buildMomentCard(opts: {
  decoded: DecodedReplay;
  ownerPlayerId: string | null;
  frameIndexOriginal: number;
  players?: Array<{ id: string; username?: string }> | null; // owner-first summary
  anonById?: Map<string, string> | null;                     // set for sample replays
  tagComment?: string | null;                                // only when a token authorized it
}): MomentCardModel {
  const frames = opts.decoded.frames ?? [];
  const idx = frames.length ? clamp(opts.frameIndexOriginal, 0, frames.length - 1) : 0;
  const state = frames[idx]?.state ?? {};
  const playerIds = Object.keys(state.players ?? {});

  const localId = opts.decoded.meta?.localPlayerId ?? null;
  const bottomId =
    (opts.ownerPlayerId && playerIds.includes(opts.ownerPlayerId)) ? opts.ownerPlayerId
    : (localId && playerIds.includes(localId)) ? localId
    : playerIds[0] ?? '';
  const topId = playerIds.find((p) => p !== bottomId) ?? bottomId;

  const labelFor = (pid: string): string =>
    opts.anonById?.get(pid)
    ?? opts.players?.find((p) => p.id === pid)?.username
    ?? state.players?.[pid]?.user?.username
    ?? 'Player';

  const sideFor = (pid: string) => buildSide(state.players?.[pid], labelFor(pid));

  return {
    matchup: { top: sideFor(topId), bottom: sideFor(bottomId) },
    roundLabel: state.roundNumber != null ? `Round ${state.roundNumber}` : 'Setup',
    frameLabel: `Frame ${idx + 1}`,
    tagLine: opts.tagComment ? truncate(opts.tagComment, TAG_MAX) : null,
  };
}
