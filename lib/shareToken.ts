// B113: signed "share this moment" tokens. Tags are team-scoped (a privacy
// boundary), but a link unfurl is fetched by a bot with no identity — so we can
// only surface a tag in the OG preview when the share link carries a token that
// proves the SHARER was allowed to see that specific tag. The token is an
// HMAC-SHA256 (keyed by AUTH_SECRET) over {slug, frameIndex, tagId}: it's minted
// by the server ONLY after re-checking the caller can view the tag (see
// /api/replays/[slug]/share-token), and it's unforgeable, so a link can never
// be hand-crafted to expose a tag the sharer couldn't see.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface MomentClaim {
  slug: string;
  frameIndex: number; // ORIGINAL frame index (matches tags.frameIndex + the ?f= URL, 0-based)
  tagId: string;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is required to sign share tokens');
  return s;
}

const b64url = (buf: Buffer | string) =>
  (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')).toString('base64url');

function sign(payloadB64: string): string {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

// token = base64url(JSON payload) + '.' + base64url(HMAC)
export function signMoment(claim: MomentClaim): string {
  const payload = b64url(JSON.stringify({ s: claim.slug, f: claim.frameIndex, g: claim.tagId }));
  return `${payload}.${sign(payload)}`;
}

export function verifyMoment(token: string | null | undefined): MomentClaim | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(sign(payloadB64), 'base64url');
    actual = Buffer.from(sigB64, 'base64url');
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (typeof obj?.s !== 'string' || typeof obj?.g !== 'string' || !Number.isInteger(obj?.f)) return null;
    return { slug: obj.s, frameIndex: obj.f, tagId: obj.g };
  } catch {
    return null;
  }
}
