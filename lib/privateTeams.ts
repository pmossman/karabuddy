// B170 / ADR 0010 — server-side private-team enforcement (metadata-only).
//
// The extension client withholds plaintext when a private team is armed without
// its key (the primary guarantee). This is the SERVER's independent backstop:
// it inspects only the `encrypted` flag + the non-secret `team_key_id` (never
// content — fully E2EE-compatible) and refuses any share that would put plaintext
// into a private team or ciphertext into a team that can't decrypt it. So a
// stale/buggy/old extension can't leak a private team's prep to teammates.

export interface TeamPrivacy {
  privateMode: boolean;
  teamKeyId: string | null;
}

export type ShareDecision = { ok: true } | { ok: false; error: string };

// May a replay (encrypted? under `replayTeamKeyId`) be shared to `team`?
export function shareAllowed(opts: {
  encrypted: boolean;
  replayTeamKeyId: string | null;
  team: TeamPrivacy;
}): ShareDecision {
  const { encrypted, replayTeamKeyId, team } = opts;
  if (team.privateMode) {
    if (!encrypted) {
      return { ok: false, error: 'private team requires an encrypted replay' };
    }
    if (!team.teamKeyId) {
      return { ok: false, error: 'private team has no encryption key configured' };
    }
    if (replayTeamKeyId !== team.teamKeyId) {
      return { ok: false, error: 'replay is encrypted under a different team key' };
    }
    return { ok: true };
  }
  // Non-private team: it has no key, so it can never receive ciphertext.
  if (encrypted) {
    return { ok: false, error: 'cannot share an encrypted replay to a non-private team' };
  }
  return { ok: true };
}

// B170 / ADR 0010: a member's readiness for a private team, for the owner's
// roster. Pure — driven by the team's key id + the member's reported extension
// capabilities + which key ids they have loaded (from extension_readiness).
//   not-seen     — the extension never reported (old/uninstalled, or hasn't pinged)
//   needs-update — reported, but without the 'privateTeams' capability
//   needs-key    — supports private teams, but hasn't loaded THIS team's key
//   ready        — supports private teams and has the key
export type MemberReadiness = 'not-seen' | 'needs-update' | 'needs-key' | 'ready';

export function memberReadinessStatus(opts: {
  teamKeyId: string | null;
  reported: boolean;
  capabilities: string[] | null | undefined;
  loadedKeyIds: string[] | null | undefined;
}): MemberReadiness {
  if (!opts.reported) return 'not-seen';
  const caps = Array.isArray(opts.capabilities) ? opts.capabilities : [];
  if (!caps.includes('privateTeams')) return 'needs-update';
  const loaded = Array.isArray(opts.loadedKeyIds) ? opts.loadedKeyIds : [];
  if (!opts.teamKeyId || !loaded.includes(opts.teamKeyId)) return 'needs-key';
  return 'ready';
}
