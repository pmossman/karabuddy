import type { CSSProperties } from 'react';
import { cardImageUrl } from '@/lib/cardImage';

// Shared leader + base image pair — the mini "matchup thumbnail" rendered all
// over the app (replay/clip cards, the replays table, the team discussion feed,
// end-game summary, tournament decks, the matchup panel, the clip end-card).
// Owns card-data normalization + image resolution + orientation/size/fit/fallback
// so the ~identical hand-rolled copies collapse to one call. NOT for the full
// deck-detail cards (count badge + swudb link) or the asymmetric stats
// leader-thumb + aspect-chip (a single thumb, not a symmetric pair).

// Accepts every leader/base data shape in the app: a {set,number,name} object,
// a "SET_NUM" string id (tournament decks / stats), or a frame {setId:{...}} card.
type CardInput =
  | string
  | { set?: string; number?: string | number; name?: string; setId?: { set?: string; number?: string | number } | null }
  | null
  | undefined;

function normalizeCard(card: CardInput): { set?: string; number?: string | number; name?: string } | null {
  if (!card) return null;
  if (typeof card === 'string') {
    const m = card.match(/^([A-Za-z0-9]+)_(\d+)$/);
    return m ? { set: m[1], number: m[2] } : null;
  }
  return { set: card.set ?? card.setId?.set, number: card.number ?? card.setId?.number, name: card.name };
}

export function LeaderBasePair({
  leader,
  base,
  orientation = 'column',
  reverse = false,
  align,
  width,
  height,
  gap,
  fit = 'contain',
  radius = 3,
  background = '#0a0c10',
  border,
  fallback = 'box',
}: {
  leader: CardInput;
  base: CardInput;
  orientation?: 'row' | 'column';
  reverse?: boolean;
  align?: 'start' | 'center' | 'end';
  width: number;
  height: number;
  gap?: number;
  fit?: 'contain' | 'cover';
  radius?: number;
  background?: string;
  border?: string;
  // box = empty bordered placeholder; name = card name; initials = first 4 chars;
  // hide = render nothing
  fallback?: 'box' | 'name' | 'initials' | 'hide';
}) {
  // `border`, when set, frames the actual image too (some sites have bordered
  // cards); pass 'none' to suppress the box placeholder's default border.
  const imgStyle: CSSProperties = { width, height, objectFit: fit, borderRadius: radius, background, display: 'block', ...(border ? { border } : {}) };
  const thumb = (card: CardInput, isLeader: boolean) => {
    const c = normalizeCard(card);
    const url = cardImageUrl(c, isLeader);
    const name = c?.name ?? '';
    if (url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={url} alt={name} title={name || undefined} loading="lazy" style={imgStyle} />;
    }
    if (fallback === 'hide') return null;
    if (fallback === 'name' || fallback === 'initials') {
      const text = fallback === 'initials' ? name.slice(0, 4) : name;
      return (
        <div style={{ ...imgStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 2, fontSize: fallback === 'initials' ? 8 : 10, lineHeight: 1.1, color: '#6c7588', overflow: 'hidden' }} title={name || undefined}>
          {text}
        </div>
      );
    }
    return <div style={{ ...imgStyle, border: border ?? '1px solid #2e333c' }} title={name || undefined} />;
  };
  const flexDirection: CSSProperties['flexDirection'] =
    orientation === 'row' ? (reverse ? 'row-reverse' : 'row') : (reverse ? 'column-reverse' : 'column');
  const alignItems = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : undefined;
  return (
    <div style={{ display: 'flex', flexDirection, gap: gap ?? (orientation === 'row' ? 2 : 1), alignItems }}>
      {thumb(leader, true)}
      {thumb(base, false)}
    </div>
  );
}
