// B170 / ADR 0010, Phase 2 — private-team upload policy (service-worker side).
//
// This is the logic that makes private mode "can't be used wrong": given the
// bubble's armed teams, the server-reported privacy state of each, and which
// team keys are loaded locally, it decides whether an upload goes out as
// PLAINTEXT, gets ENCRYPTED, or is WITHHELD (kept local, prompt the user) —
// so a private team's prep can never silently leak as plaintext.
//
// Pure + dependency-free so it unit-tests in isolation; the SW (background.js)
// imports it as an ES module. The actual crypto lives in 00-e2ee.js; the actual
// key bytes live in chrome.storage.local under KEY_STORAGE_PREFIX. NEITHER the
// key nor plaintext ever crosses to the server (see ADR 0010 threat model).

// chrome.storage.local key under which a team key is stored, namespaced by the
// non-secret team_key_id. The key bytes (base64url) are the value.
export const KEY_STORAGE_PREFIX = 'karabuddyPrivateKey:';
export function keyStorageKey(teamKeyId) {
  return KEY_STORAGE_PREFIX + teamKeyId;
}

// The team key ids for which a key is stored locally, derived from a
// chrome.storage.local.get(null) dump (the SW can't easily enumerate by prefix
// otherwise). Pure so it's unit-tested; the SW just feeds it the dump.
export function loadedKeyIdsFromStorage(storage) {
  if (!storage || typeof storage !== 'object') return [];
  return Object.keys(storage)
    .filter((k) => k.startsWith(KEY_STORAGE_PREFIX))
    .map((k) => k.slice(KEY_STORAGE_PREFIX.length));
}

// Build the slug → { privateMode, teamKeyId } map the upload decision needs,
// from the `teams` array of /api/me/teams-mention-data. Missing privacy fields
// default to non-private (so an old server / unknown team never forces a leak —
// it just falls to the plaintext path, which the server still backstops).
export function privacyMapFromTeams(teams) {
  const map = {};
  if (Array.isArray(teams)) {
    for (const t of teams) {
      if (t && typeof t.slug === 'string') {
        map[t.slug] = { privateMode: !!t.privateMode, teamKeyId: t.teamKeyId ?? null };
      }
    }
  }
  return map;
}

// Decide how to handle an upload given the armed teams.
//   armed:          string[] of armed team slugs
//   privacyBySlug:  { [slug]: { privateMode: boolean, teamKeyId: string|null } }
//   loadedKeyIds:   string[] of team_key_ids for which a key is loaded locally
// Returns one of:
//   { mode: 'plaintext', shareTeamSlugs }
//   { mode: 'encrypt',   teamKeyId, shareTeamSlugs, droppedNonPrivate }
//   { mode: 'withhold',  reason: 'no-key'|'key-conflict'|'misconfigured', teamKeyId?, teams }
export function decideUploadMode({ armed, privacyBySlug, loadedKeyIds }) {
  const slugs = Array.isArray(armed) ? armed : [];
  const privacy = privacyBySlug || {};
  const loaded = new Set(Array.isArray(loadedKeyIds) ? loadedKeyIds : []);

  const armedPrivate = slugs.filter((s) => privacy[s] && privacy[s].privateMode);

  // No private team armed → unchanged plaintext path (shares everything armed).
  if (armedPrivate.length === 0) {
    return { mode: 'plaintext', shareTeamSlugs: slugs };
  }

  // A private team with no team_key_id is misconfigured — we must NOT fall back
  // to plaintext (that's the leak we're preventing), so withhold.
  const missingKid = armedPrivate.filter((s) => !privacy[s].teamKeyId);
  if (missingKid.length > 0) {
    return { mode: 'withhold', reason: 'misconfigured', teams: armedPrivate };
  }

  // One blob is encrypted under one key, so all armed private teams must share
  // the same team_key_id; differing keys can't be served by a single upload.
  const kids = Array.from(new Set(armedPrivate.map((s) => privacy[s].teamKeyId)));
  if (kids.length > 1) {
    return { mode: 'withhold', reason: 'key-conflict', teams: armedPrivate };
  }

  const teamKeyId = kids[0];
  if (!loaded.has(teamKeyId)) {
    return { mode: 'withhold', reason: 'no-key', teamKeyId, teams: armedPrivate };
  }

  // Encrypt and share EXCLUSIVELY to the private team(s) — never plaintext-share
  // to any non-private team that was also armed (they can't decrypt anyway).
  return {
    mode: 'encrypt',
    teamKeyId,
    shareTeamSlugs: armedPrivate,
    droppedNonPrivate: slugs.filter((s) => !armedPrivate.includes(s)),
  };
}
