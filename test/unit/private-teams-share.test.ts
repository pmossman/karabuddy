import { describe, expect, it } from 'vitest';
import { shareAllowed, memberReadinessStatus } from '@/lib/privateTeams';

// B170 / ADR 0010: server-side defense-in-depth. The client withholds plaintext
// for a private team, but the server independently enforces (metadata-only, no
// decryption) that an encrypted replay only shares into the matching private
// team and a plaintext replay never shares into a private team. This pure rule
// backstops a stale/buggy/old extension so a leak can't reach teammates.

const PRIV = (teamKeyId: string | null) => ({ privateMode: true, teamKeyId });
const PUB = { privateMode: false, teamKeyId: null };

describe('shareAllowed', () => {
  it('plaintext replay → non-private team: allowed (today’s path)', () => {
    expect(shareAllowed({ encrypted: false, replayTeamKeyId: null, team: PUB }).ok).toBe(true);
  });

  it('encrypted replay (matching kid) → private team: allowed', () => {
    expect(shareAllowed({ encrypted: true, replayTeamKeyId: 'kid1', team: PRIV('kid1') }).ok).toBe(true);
  });

  it('plaintext replay → private team: REJECTED (the leak we prevent)', () => {
    const r = shareAllowed({ encrypted: false, replayTeamKeyId: null, team: PRIV('kid1') });
    expect(r.ok).toBe(false);
  });

  it('encrypted replay → non-private team: REJECTED (they have no key)', () => {
    const r = shareAllowed({ encrypted: true, replayTeamKeyId: 'kid1', team: PUB });
    expect(r.ok).toBe(false);
  });

  it('encrypted replay with WRONG kid → private team: REJECTED', () => {
    const r = shareAllowed({ encrypted: true, replayTeamKeyId: 'kidX', team: PRIV('kid1') });
    expect(r.ok).toBe(false);
  });

  it('private team with no key configured: REJECTED (misconfigured)', () => {
    const r = shareAllowed({ encrypted: true, replayTeamKeyId: 'kid1', team: PRIV(null) });
    expect(r.ok).toBe(false);
  });
});

describe('memberReadinessStatus', () => {
  const base = { teamKeyId: 'kid1' };
  it('never reported → not-seen', () => {
    expect(memberReadinessStatus({ ...base, reported: false, capabilities: null, loadedKeyIds: null })).toBe('not-seen');
  });
  it('reported without the privateTeams capability → needs-update', () => {
    expect(memberReadinessStatus({ ...base, reported: true, capabilities: [], loadedKeyIds: [] })).toBe('needs-update');
  });
  it('supports private teams but lacks this team key → needs-key', () => {
    expect(memberReadinessStatus({ ...base, reported: true, capabilities: ['privateTeams'], loadedKeyIds: ['other'] })).toBe('needs-key');
  });
  it('supports private teams and has the key → ready', () => {
    expect(memberReadinessStatus({ ...base, reported: true, capabilities: ['privateTeams'], loadedKeyIds: ['kid1'] })).toBe('ready');
  });
});
