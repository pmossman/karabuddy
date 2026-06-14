import { describe, it, expect } from 'vitest';
import { serializeClipRow } from '@/lib/clipRow';

// B142: pure clip-row serializer — matchup from the parent replay + clip fields,
// anonymized when the viewer isn't entitled.

const clip = { slug: 'cl_x', replaySlug: 'r1', startFrame: 10, endFrame: 40, title: 'nice', createdAt: new Date('2026-06-14T00:00:00Z') };
const replay = {
  slug: 'r1', gameId: 'g1', userId: 'owner', ownerToken: 'tok', createdAt: new Date(),
  players: [{ id: 'p1', username: 'RealA', leader: { name: 'Boba' } }, { id: 'p2', username: 'RealB', leader: { name: 'Cad' } }],
  ownerPlayerId: 'p1', match: null, displayName: "Parker's deck", labels: null, winners: null,
};

describe('serializeClipRow', () => {
  it('keeps real identities + computes frameCount when entitled', () => {
    const row = serializeClipRow(clip, replay, { anonymize: false, creatorName: 'Parker', isMine: true, canDelete: true });
    expect(row.clipSlug).toBe('cl_x');
    expect(row.frameCount).toBe(31); // 40 - 10 + 1
    expect(row.players.map((p: any) => p.username)).toEqual(['RealA', 'RealB']);
    expect(row.ownLeader?.name).toBe('Boba');
    expect(row.creatorName).toBe('Parker');
    expect(row.replayDisplayName).toBe("Parker's deck");
    expect(row.isMine).toBe(true);
  });

  it('anonymizes names + drops display name + creator when not entitled (deck info survives)', () => {
    const row = serializeClipRow(clip, replay, { anonymize: true, creatorName: 'Parker', isMine: false, canDelete: false });
    expect(row.players.map((p: any) => p.username)).toEqual(['Player1', 'Player2']);
    expect(row.players.map((p: any) => p.leader?.name)).toEqual(['Boba', 'Cad']);
    expect(row.ownerPlayerId).toBeNull();
    expect(row.creatorName).toBeNull();
    expect(row.replayDisplayName).toBeNull();
    expect(JSON.stringify(row)).not.toContain('RealA');
  });
});
