// Short, URL-safe replay slugs (e.g. "r_a4f8x2"). Crockford-ish base32
// minus ambiguous chars (no 0/O, 1/I/l). 6 chars = 32^6 ≈ 1B possibilities
// — collisions are vanishingly unlikely at our scale; if they ever happen
// the unique index on `slug` + retry-once handles them.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function generateSlug(prefix = 'r_', length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix + s;
}

export function generateTagId(): string {
  // 16 char id for tags — collisions truly negligible.
  return generateSlug('tag_', 16);
}
