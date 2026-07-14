import { describe, it, expect } from 'vitest';
import { getDb } from '@/lib/db';
import { cards } from '@/lib/schema';
import { resolveBaseIdentities, attachBaseKinds } from '@/lib/baseIdentity';
import { baseAbilityHash } from '@/lib/cards';

// lib/baseIdentity against a seeded catalog: vanilla → aspect; FORCE and SPLASH
// bases (base_subtype, community-recognized shared kinds) render as aspect +
// force/splash glyph and stay distinct even same-aspect; reprints join their
// group; unique bases stay unique; unknown cards fall back to name identity.

const forceHash = baseAbilityHash('When a friendly Force unit attacks: The Force is with you (create your Force token).')!;
const splashHash = baseAbilityHash('Epic Action: Play a card from your hand, ignoring 1 of its aspect penalties.')!;
const sharedHash = baseAbilityHash('Some future shared ability we do not yet classify.')!;

async function seedCatalog() {
  await getDb()
    .insert(cards)
    .values([
      // Two vanilla vigilance bases — interchangeable.
      { cardId: 'TST_001', name: 'Vanilla One', type: 'base', set: 'TST', number: 1, aspects: ['vigilance'], hasAbility: false, baseAbilityHash: null, baseSubtype: null, source: 'seed' },
      { cardId: 'TST_002', name: 'Vanilla Two', type: 'base', set: 'TST', number: 2, aspects: ['vigilance'], hasAbility: false, baseAbilityHash: null, baseSubtype: null, source: 'seed' },
      // A FORCE pair (+ a reprint of one) — classified base_subtype='force'.
      { cardId: 'TST_010', name: 'Force Alpha', type: 'base', set: 'TST', number: 10, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, baseSubtype: 'force', source: 'seed' },
      { cardId: 'TST_011', name: 'Force Beta', type: 'base', set: 'TST', number: 11, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, baseSubtype: 'force', source: 'seed' },
      { cardId: 'TST_910', name: 'Force Alpha', type: 'base', set: 'TST', number: 910, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: forceHash, baseSubtype: 'force', source: 'seed' },
      // A SPLASH pair of the SAME aspect — must read distinctly (by TYPE) from force.
      { cardId: 'TST_030', name: 'Splash Gamma', type: 'base', set: 'TST', number: 30, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: splashHash, baseSubtype: 'splash', source: 'seed' },
      { cardId: 'TST_031', name: 'Splash Delta', type: 'base', set: 'TST', number: 31, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: splashHash, baseSubtype: 'splash', source: 'seed' },
      // An unclassified shared ability (2 names, no subtype) → name-joined fallback.
      { cardId: 'TST_040', name: 'Shared Eps', type: 'base', set: 'TST', number: 40, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: sharedHash, baseSubtype: null, source: 'seed' },
      { cardId: 'TST_041', name: 'Shared Zeta', type: 'base', set: 'TST', number: 41, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: sharedHash, baseSubtype: null, source: 'seed' },
      // A genuinely unique ability base.
      { cardId: 'TST_020', name: 'Unique Spire', type: 'base', set: 'TST', number: 20, aspects: ['vigilance'], hasAbility: true, baseAbilityHash: baseAbilityHash('Epic Action: something singular.'), baseSubtype: null, source: 'seed' },
    ])
    .onConflictDoNothing();
}

describe('base functional identity', () => {
  it('vanilla → aspect; force/splash bases distinct by type; unique + unknown', async () => {
    await seedCatalog();
    const ids = await resolveBaseIdentities([
      { set: 'TST', number: 1, name: 'Vanilla One' },
      { set: 'TST', number: 10, name: 'Force Alpha' },
      { set: 'TST', number: 11, name: 'Force Beta' },
      { set: 'TST', number: 910, name: 'Force Alpha' },
      { set: 'TST', number: 30, name: 'Splash Gamma' },
      { set: 'TST', number: 40, name: 'Shared Eps' },
      { set: 'TST', number: 41, name: 'Shared Zeta' },
      { set: 'TST', number: 20, name: 'Unique Spire' },
      { set: 'ZZZ', number: 99, name: 'Mystery Base' },
    ]);

    // Vanilla → aspect group, aspect icon, no overlay, no art.
    expect(ids.get('TST_001')!.key).toBe('asp:vigilance');
    expect(ids.get('TST_001')!.label).toBe('Vigilance base');
    expect(ids.get('TST_001')!.iconAspect).toBe('vigilance');
    expect(ids.get('TST_001')!.overlay).toBeNull();

    // FORCE pair + reprint: one group, kind 'force', aspect+force glyph.
    const alpha = ids.get('TST_010')!;
    expect(alpha.key).toBe(`ab:vigilance:${forceHash}`);
    expect(ids.get('TST_011')!.key).toBe(alpha.key);
    expect(ids.get('TST_910')!.key).toBe(alpha.key);
    expect(alpha.kind).toBe('force');
    expect(alpha.label).toBe('Vigilance · Force');
    expect(alpha.iconAspect).toBe('vigilance');
    expect(alpha.overlay).toBe('force');

    // SPLASH pair, SAME aspect — distinct kind/label/overlay (the real bug).
    const gamma = ids.get('TST_030')!;
    expect(gamma.kind).toBe('splash');
    expect(gamma.key).not.toBe(alpha.key);
    expect(gamma.label).toBe('Vigilance · Splash');
    expect(gamma.overlay).toBe('splash');

    // Unclassified shared ability → name-joined fallback, no overlay.
    const eps = ids.get('TST_040')!;
    expect(eps.kind).toBe('shared');
    expect(eps.label).toBe('Shared Eps / Shared Zeta');
    expect(eps.overlay).toBeNull();

    // Unique: own key, own name, card art.
    const unique = ids.get('TST_020')!;
    expect(unique.kind).toBe('unique');
    expect(unique.label).toBe('Unique Spire');
    expect(unique.art).toEqual({ set: 'TST', number: 20 });

    // Unknown card: name fallback.
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
