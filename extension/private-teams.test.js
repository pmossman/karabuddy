import { describe, it, expect } from 'vitest';
import {
  decideUploadMode,
  KEY_STORAGE_PREFIX,
  keyStorageKey,
  loadedKeyIdsFromStorage,
  privacyMapFromTeams,
} from './private-teams.js';

// B170 / ADR 0010, Phase 2: the SW-side decision that makes private mode
// "can't be used wrong." Given the armed teams + their server-reported privacy
// state + which team keys are loaded locally, decide whether to upload
// plaintext, encrypt, or WITHHOLD (keep local, never send plaintext). This is
// the security-critical core — exhaustively tested. Pure logic, runs in the SW.

const PRIV = (teamKeyId) => ({ privateMode: true, teamKeyId });
const PUB = { privateMode: false, teamKeyId: null };

describe('decideUploadMode', () => {
  it('no armed teams → plaintext (today’s behavior)', () => {
    expect(decideUploadMode({ armed: [], privacyBySlug: {}, loadedKeyIds: [] }))
      .toEqual({ mode: 'plaintext', shareTeamSlugs: [] });
  });

  it('only non-private teams armed → plaintext, shares all', () => {
    const r = decideUploadMode({ armed: ['a', 'b'], privacyBySlug: { a: PUB, b: PUB }, loadedKeyIds: [] });
    expect(r).toEqual({ mode: 'plaintext', shareTeamSlugs: ['a', 'b'] });
  });

  it('private team armed + key loaded → encrypt, share ONLY the private team', () => {
    const r = decideUploadMode({ armed: ['p'], privacyBySlug: { p: PRIV('kid1') }, loadedKeyIds: ['kid1'] });
    expect(r.mode).toBe('encrypt');
    expect(r.teamKeyId).toBe('kid1');
    expect(r.shareTeamSlugs).toEqual(['p']);
  });

  it('private team armed + key NOT loaded → withhold (no plaintext leaves the browser)', () => {
    const r = decideUploadMode({ armed: ['p'], privacyBySlug: { p: PRIV('kid1') }, loadedKeyIds: [] });
    expect(r.mode).toBe('withhold');
    expect(r.reason).toBe('no-key');
    expect(r.teamKeyId).toBe('kid1');
    expect(r.teams).toEqual(['p']);
  });

  it('private + non-private armed together → encrypt exclusively, DROP the non-private shares', () => {
    const r = decideUploadMode({
      armed: ['p', 'pub'],
      privacyBySlug: { p: PRIV('kid1'), pub: PUB },
      loadedKeyIds: ['kid1'],
    });
    expect(r.mode).toBe('encrypt');
    expect(r.shareTeamSlugs).toEqual(['p']); // exclusive — never plaintext-shares to pub
    expect(r.droppedNonPrivate).toEqual(['pub']);
  });

  it('two private teams with the SAME key → encrypt, share both', () => {
    const r = decideUploadMode({
      armed: ['p1', 'p2'],
      privacyBySlug: { p1: PRIV('kid1'), p2: PRIV('kid1') },
      loadedKeyIds: ['kid1'],
    });
    expect(r.mode).toBe('encrypt');
    expect(r.shareTeamSlugs).toEqual(['p1', 'p2']);
  });

  it('two private teams with DIFFERENT keys → withhold (one blob can’t serve two keys)', () => {
    const r = decideUploadMode({
      armed: ['p1', 'p2'],
      privacyBySlug: { p1: PRIV('kid1'), p2: PRIV('kid2') },
      loadedKeyIds: ['kid1', 'kid2'],
    });
    expect(r.mode).toBe('withhold');
    expect(r.reason).toBe('key-conflict');
    expect(r.teams.sort()).toEqual(['p1', 'p2']);
  });

  it('private team with private_mode but NO team_key_id → withhold (misconfigured, never plaintext)', () => {
    const r = decideUploadMode({
      armed: ['p'],
      privacyBySlug: { p: { privateMode: true, teamKeyId: null } },
      loadedKeyIds: [],
    });
    expect(r.mode).toBe('withhold');
    expect(r.reason).toBe('misconfigured');
  });

  it('unknown armed slug (no privacy info) is treated as non-private', () => {
    const r = decideUploadMode({ armed: ['ghost'], privacyBySlug: {}, loadedKeyIds: [] });
    expect(r).toEqual({ mode: 'plaintext', shareTeamSlugs: ['ghost'] });
  });
});

describe('keyStorageKey', () => {
  it('namespaces a team key id under the private-key prefix', () => {
    expect(keyStorageKey('kid1')).toBe(`${KEY_STORAGE_PREFIX}kid1`);
    expect(KEY_STORAGE_PREFIX).toMatch(/private/i);
  });
});

describe('loadedKeyIdsFromStorage', () => {
  it('extracts the team key ids from a chrome.storage.local dump, ignoring other keys', () => {
    const storage = {
      karabuddyInstallToken: 'kbx_x',
      [keyStorageKey('kid1')]: 'KEYBYTES1',
      [keyStorageKey('kid2')]: 'KEYBYTES2',
      karabuddyShareTeamSlugs: ['t'],
    };
    expect(loadedKeyIdsFromStorage(storage).sort()).toEqual(['kid1', 'kid2']);
  });
  it('returns [] for empty / non-object input', () => {
    expect(loadedKeyIdsFromStorage(null)).toEqual([]);
    expect(loadedKeyIdsFromStorage({})).toEqual([]);
  });
});

describe('privacyMapFromTeams', () => {
  it('builds slug → {privateMode, teamKeyId} from the teams-mention-data teams array', () => {
    const map = privacyMapFromTeams([
      { slug: 'a', name: 'A', privateMode: true, teamKeyId: 'kid1' },
      { slug: 'b', name: 'B', privateMode: false, teamKeyId: null },
      { slug: 'c', name: 'C' }, // missing privacy fields → non-private
    ]);
    expect(map.a).toEqual({ privateMode: true, teamKeyId: 'kid1' });
    expect(map.b).toEqual({ privateMode: false, teamKeyId: null });
    expect(map.c).toEqual({ privateMode: false, teamKeyId: null });
  });
  it('tolerates non-array input', () => {
    expect(privacyMapFromTeams(undefined)).toEqual({});
  });
});
