import { describe, it, expect } from 'vitest';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';
import { resolveBaseIdentities, attachBaseKinds } from '@/lib/baseIdentity';
import { baseAbilityHash } from '@/lib/cards';

// lib/baseIdentity against a seeded catalog: vanilla bases collapse to their
// aspect, force pairs (two names, identical text) collapse to one shared
// group, reprints join their group, unique bases stay unique, and cards the
// catalog doesn't know fall back to name identity.

const FORCE_TEXT = 'When a friendly Force unit attacks: The Force is with you (create your Force token).';
const forceHash = baseAbilityHash(FORCE_TEXT)!;

async function seedCatalog() {
  await getDb()
    .insert(cards)
    .values([
      // Two vanilla vigilance bases — interchangeable.
      { cardId: 'TST_001', name: 'Vanilla One', type: 'base', set: 'TST', number: 1, aspects: ['vigilance'], hasAbility: false, baseAbilityHash: null, source: 'seed' },
      { cardId: 'TST_002', name: 'Vanilla Two', type: 'base', set: 'TST', number: 2, aspects: ['vigilance'], hasAbility: false, baseAbilityHash: null, source: 'seed' },
      // A force pair: two NAMES sharing the ability text (+ a reprint of one).
      { cardId: 'TST_010', name: 'Force Alpha', type: 'base', set: 'TST', number: 10, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, source: 'seed' },
      { cardId: 'TST_011', name: 'Force Beta', type: 'base', set: 'TST', number: 11, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, source: 'seed' },
      { cardId: 'TST_910', name: 'Force Alpha', type: 'base', set: 'TST', number: 910, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, source: 'seed' },
      // A genuinely unique ability base.
      { cardId: 'TST_020', name: 'Unique Spire', type: 'base', set: 'TST', number: 20, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: baseAbilityHash('Epic Action: something singular.'), source: 'seed' },
    ])
    .onConflictDoNothing();
}

describe('base functional identity', () => {
  it('vanilla → aspect; force pair + reprint → one shared group; unique stays unique; unknown falls back to name', async () => {
    await seedCatalog();
    const ids = await resolveBaseIdentities([
      { set: 'TST', number: 1, name: 'Vanilla One' },
      { set: 'TST', number: 2, name: 'Vanilla Two' },
      { set: 'TST', number: 10, name: 'Force Alpha' },
      { set: 'TST', number: 11, name: 'Force Beta' },
      { set: 'TST', number: 910, name: 'Force Alpha' },
      { set: 'TST', number: 20, name: 'Unique Spire' },
      { set: 'ZZZ', number: 99, name: 'Mystery Base' },
    ]);

    // Vanilla: both collapse to the aspect group, aspect icon, no card art.
    expect(ids.get('TST_001')!.key).toBe('asp:vigilance');
    expect(ids.get('TST_002')!.key).toBe('asp:vigilance');
    expect(ids.get('TST_001')!.label).toBe('Vigilance base');
    expect(ids.get('TST_001')!.iconAspect).toBe('vigilance');
    expect(ids.get('TST_001')!.art).toBeNull();

    // Force pair + the reprint: ONE shared group.
    const alpha = ids.get('TST_010')!;
    expect(alpha.key).toBe(`ab:vigilance:${forceHash}`);
    expect(ids.get('TST_011')!.key).toBe(alpha.key);
    expect(ids.get('TST_910')!.key).toBe(alpha.key);
    expect(alpha.kind).toBe('shared');
    expect(alpha.label).toBe('Vigilance force base');
    expect(alpha.iconAspect).toBe('vigilance');

    // Unique: own key, own name, card art.
    const unique = ids.get('TST_020')!;
    expect(unique.kind).toBe('unique');
    expect(unique.label).toBe('Unique Spire');
    expect(unique.art).toEqual({ set: 'TST', number: 20 });

    // Unknown card: name fallback so filters still work.
    const mystery = ids.get('ZZZ_099')!;
    expect(mystery.kind).toBe('unknown');
    expect(mystery.key).toBe('name:Mystery Base');
  });

  it('attachBaseKinds decorates serialized rows in place', async () => {
    await seedCatalog();
    const rows = [
      { ownBase: { set: 'TST', number: 1, name: 'Vanilla One' }, oppBase: { set: 'TST', number: 11, name: 'Force Beta' } },
      { ownBase: null, oppBase: null },
    ] as any[];
    await attachBaseKinds(rows);
    expect(rows[0].ownBaseKind.key).toBe('asp:vigilance');
    expect(rows[0].oppBaseKind.key).toBe(`ab:vigilance:${forceHash}`);
    expect(rows[1].ownBaseKind).toBeNull();
  });
});
