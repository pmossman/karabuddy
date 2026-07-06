import { describe, it, expect } from 'vitest';
import { swuCardToRow, cardIdFromSetNumber, baseAbilityHash } from './cards';

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
  it('maps a unit: cost parsed, aspects lowercased, arena from Arenas, subtitle carried', () => {
    const r = swuCardToRow({ Set: 'SOR', Number: '005', Name: 'Luke Skywalker', Subtitle: 'Jedi Knight', Cost: '7', Type: 'Unit', Aspects: ['Vigilance'], Arenas: ['Ground'], Traits: ['Force', 'Rebel'] });
    expect(r).toEqual({
      cardId: 'SOR_005', name: 'Luke Skywalker', subtitle: 'Jedi Knight', set: 'SOR', number: 5,
      aspects: ['vigilance'], cost: 7, type: 'unit', arena: 'ground', traits: ['Force', 'Rebel'], hasAbility: null, baseAbilityHash: null, source: 'seed',
    });
  });
  it('subtitle is null when the card has none', () => {
    expect(swuCardToRow({ Set: 'SOR', Number: '059', Name: '2-1B Surgical Droid', Type: 'Unit' }).subtitle).toBeNull();
  });
  it('flags ability bases (has text) vs vanilla bases (no text); non-bases get null', () => {
    // Vanilla aspect+HP base (no text) → collapses to its aspect.
    expect(swuCardToRow({ Set: 'SOR', Number: '022', Type: 'Base', Aspects: ['Command'] }).hasAbility).toBe(false);
    // Ability base (Epic Action) → its own deck.
    expect(swuCardToRow({ Set: 'SOR', Number: '025', Type: 'Base', Aspects: ['Aggression'], FrontText: 'Epic Action: Deal 3 damage to a damaged non-leader unit.' }).hasAbility).toBe(true);
    // The LAW "splash" bases have text too → distinct.
    expect(swuCardToRow({ Set: 'LAW', Number: '023', Type: 'Base', Aspects: ['Command'], Text: 'Epic Action: Play a card from your hand, ignoring 1 of its Vigilance…' }).hasAbility).toBe(true);
    // Non-base → null (never imply a unit "has no ability").
    expect(swuCardToRow({ Set: 'SOR', Number: '100', Type: 'Unit', FrontText: 'When Played: draw a card.' }).hasAbility).toBeNull();
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

describe('baseAbilityHash (base functional identity)', () => {
  it('normalizes whitespace + case; empty/blank → null', () => {
    const a = baseAbilityHash('When a friendly Force unit attacks: The Force is with you.');
    expect(a).toBe(baseAbilityHash('  when a friendly force  unit attacks:\nthe force is with you.  '));
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(baseAbilityHash('')).toBeNull();
    expect(baseAbilityHash('   ')).toBeNull();
    expect(baseAbilityHash(null)).toBeNull();
  });
  it('different text → different hash', () => {
    expect(baseAbilityHash('Epic Action: deal 2 damage.')).not.toBe(baseAbilityHash('Epic Action: heal 2 damage.'));
  });
});
