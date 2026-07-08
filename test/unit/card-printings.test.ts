import { describe, it, expect } from 'vitest';
import { canonicalCardId } from '@/lib/cardPrintings';

// B226 fix: pick the deck-legal base printing (lowest number, 3-letter set, no
// suffix) so the finder shows real art and de-dupes reprints sensibly.
describe('canonicalCardId', () => {
  it('prefers the base printing over variants (Trust Me → SEC_068)', () => {
    expect(canonicalCardId(['SECOP_003', 'SEC_332', 'SEC_068', 'SEC_1055', 'SECOP_023'])).toBe('SEC_068');
  });

  it('skips foil (F) variants (Responsible → SOR_197)', () => {
    expect(canonicalCardId(['SOR_197F', 'SOR_459', 'SOR_197', 'SOR_459F'])).toBe('SOR_197');
  });

  it('takes the lowest base number', () => {
    expect(canonicalCardId(['LAW_848', 'LAW_108', 'LAW_372'])).toBe('LAW_108');
  });

  it('falls back to the lowest when every printing is a variant', () => {
    expect(canonicalCardId(['SECOP_023', 'SECOP_003'])).toBe('SECOP_003');
  });

  it('single printing → itself', () => {
    expect(canonicalCardId(['JTL_140'])).toBe('JTL_140');
  });
});
