// The canonical aspect glyph — the deck-"color" indicator (command=green,
// cunning=yellow, aggression=red, vigilance=blue, heroism, villainy). Used for
// base colors, aspect filters, and matchup labels. One place owns the asset
// path so we never drift (guarded in canonical-components.test.ts).

export function AspectIcon({ aspect, size = 18, overlay, style }: { aspect: string; size?: number; overlay?: 'force' | 'splash' | null; style?: React.CSSProperties }) {
  const glyph = (src: string, alt: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} title={alt} style={{ width: size, height: size, display: 'block', flexShrink: 0 }} />
  );
  // Force/splash bases render the aspect glyph + the force/splash glyph
  // (/aspect-icons/{force,splash}.webp) — the community convention.
  if (overlay) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.max(2, Math.round(size * 0.14)), ...style }}>
        {glyph(`/aspect-icons/aspect-${aspect}.webp`, aspect)}
        {glyph(`/aspect-icons/${overlay}.webp`, overlay)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/aspect-icons/aspect-${aspect}.webp`} alt={aspect} title={aspect} style={{ width: size, height: size, display: 'block', flexShrink: 0, ...style }} />
  );
}
