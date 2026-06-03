import { describe, it, expect } from 'vitest';
import { swuCardToRow, cardIdFromSetNumber } from './cards';

describe('cardIdFromSetNumber', () => {
  it('zero-pads numeric numbers to 3 (matching the gamestate-derived id)', () => {
    expect(cardIdFromSetNumber('SOR', '59')).toBe('SOR_059');
    expect(cardIdFromSetNumber('SOR', 1)).toBe('SOR_001');
    expect(cardIdFromSetNumber('JTL', '240')).toBe('JTL_240');
    expect(cardIdFromSetNumber('SOR', '059')).toBe('SOR_059'); // already padded
  });
  it('passes non-numeric numbers through raw', () => {
    expect(cardIdFromSetNumber('SOR', 'T01')).toBe('SOR_T01');
  });
});

describe('swuCardToRow', () => {
  it('maps a unit: cost parsed, aspects lowercased, arena from Arenas', () => {
    const r = swuCardToRow({ Set: 'SOR', Number: '059', Name: '2-1B Surgical Droid', Cost: '1', Type: 'Unit', Aspects: ['Vigilance'], Arenas: ['Ground'], Traits: ['Droid'] });
    expect(r).toEqual({
      cardId: 'SOR_059', name: '2-1B Surgical Droid', set: 'SOR', number: 59,
      aspects: ['vigilance'], cost: 1, type: 'unit', arena: 'ground', traits: ['Droid'], source: 'seed',
    });
  });
  it('handles a free event (cost 0) vs a missing/blank cost (null)', () => {
    expect(swuCardToRow({ Set: 'SHD', Number: '012', Cost: '0', Type: 'Event' }).cost).toBe(0);
    expect(swuCardToRow({ Set: 'SHD', Number: '013', Cost: '', Type: 'Leader' }).cost).toBeNull();
    expect(swuCardToRow({ Set: 'SHD', Number: '014', Type: 'Base' }).cost).toBeNull();
  });
  it('events/leaders/bases have no arena', () => {
    expect(swuCardToRow({ Set: 'SOR', Number: '100', Type: 'Event', Cost: '2' }).arena).toBeNull();
  });
});
