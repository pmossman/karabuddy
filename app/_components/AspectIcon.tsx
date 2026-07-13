// The canonical aspect glyph — the deck-"color" indicator (command=green,
// cunning=yellow, aggression=red, vigilance=blue, heroism, villainy). Used for
// base colors, aspect filters, and matchup labels. One place owns the asset
// path so we never drift (guarded in canonical-components.test.ts).

export function AspectIcon({ aspect, size = 18, style }: { aspect: string; size?: number; style?: React.CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/aspect-icons/aspect-${aspect}.webp`}
      alt={aspect}
      title={aspect}
      style={{ width: size, height: size, display: 'block', flexShrink: 0, ...style }}
    />
  );
}
