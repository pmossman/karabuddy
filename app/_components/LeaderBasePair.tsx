import type { CSSProperties } from 'react';
import { cardImageUrl } from '@/lib/cardImage';

// Shared leader + base image pair — the mini "matchup thumbnail" rendered all
// over the app (replay/clip cards, the replays table, the team discussion feed).
// Owns image resolution + orientation/size/fit/fallback so the ~identical
// hand-rolled copies collapse to one call. NOT for the full deck-detail cards
// (count badge + swudb link) or the asymmetric stats leader+aspect chip.
type CardLike = { set?: string; number?: string | number; name?: string } | null | undefined;

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
  leader: CardLike;
  base: CardLike;
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
  // box = empty bordered placeholder; name = show the card name; hide = render nothing
  fallback?: 'box' | 'name' | 'hide';
}) {
  const imgStyle: CSSProperties = { width, height, objectFit: fit, borderRadius: radius, background, display: 'block' };
  const thumb = (card: CardLike, isLeader: boolean) => {
    const url = cardImageUrl(card ?? null, isLeader);
    const name = card?.name ?? '';
    if (url) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={url} alt={name} title={name || undefined} loading="lazy" style={imgStyle} />;
    }
    if (fallback === 'hide') return null;
    if (fallback === 'name') {
      return (
        <div style={{ ...imgStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 2, fontSize: 10, lineHeight: 1.1, color: '#6c7588', overflow: 'hidden' }} title={name || undefined}>
          {name}
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
