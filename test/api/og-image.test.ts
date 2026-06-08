import { describe, it, expect } from 'vitest';
import { GET as ogImage } from '@/app/api/replays/[slug]/og-image/route';

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
const get = (slug: string, qs = '') => ogImage(new Request(`http://t/api/replays/${slug}/og-image${qs}`), params(slug));

describe('B113 og-image route', () => {
  it('returns a PNG for an unknown replay (never 404s an unfurl)', async () => {
    const res = await get('r_nope', '?f=3');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});
