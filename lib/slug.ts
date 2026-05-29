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

// B55a: team slugs — 6 chars without prefix so URLs look like `/teams/k7x4dq`
// instead of `/teams/t_k7x4dq`. Same alphabet (Crockford-ish base32, no
// ambiguous chars). 32^6 ≈ 1B possibilities; collision on retry-once.
export function generateTeamSlug(): string {
  return generateSlug('', 6);
}

// B55a: team invite codes — 10 chars, no prefix. Longer than slugs because
// invites grant write access (membership) and are URL-shared; harder to
// guess matters more here than visual brevity.
export function generateInviteCode(): string {
  return generateSlug('', 10);
}
