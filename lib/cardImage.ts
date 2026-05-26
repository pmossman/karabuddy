// Resolve leader/base/card images. Routes through our /card-art proxy
// (defined in next.config.ts) so we don't hotlink karabast's S3 from
// production users' browsers.
export function cardImageUrl(card: {
  set?: string;
  number?: number | string;
} | null, isLeader = false): string | null {
  if (!card || !card.set || !card.number) return null;
  const suffix = isLeader ? '-base' : '';
  const num = String(card.number).padStart(3, '0');
  return `/card-art/${card.set.toUpperCase()}/standard/large/${num}${suffix}.webp?v=2`;
}
