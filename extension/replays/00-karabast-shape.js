// B80: SHARED karabast upstream-drift detector. Dependency-free plain JS so the
// EXACT same rule runs in both surfaces (web app/cron imports it; the buildless
// extension uses a byte-identical copy at extension/replays/00-karabast-shape.js
// loaded before 03-recorder) — same pattern as commentScope.js, parity-tested.
//
// The extension reports drift via a content-free beacon carrying ONLY codes
// from the fixed set below + the extension version. The server rejects any code
// not in knownIssueCodes(), so by construction NO game data / usernames / card
// ids can ride along. Codes are the wire enum — STABLE; add, never repurpose.
//
// Our capture/decode pipeline depends on these karabast gamestate fields:
//   id, players{}, players[].user.username, players[].cardPiles.hand,
//   players[].leader/base.setId, players[].isActionPhaseActivePlayer.
// If karabast renames/restructures any, uploads keep "succeeding" but produce
// broken payloads — this catches that.

const KB_ISSUE = {
  MISSING_SNAPSHOT: 'missing_snapshot',
  MISSING_GAMEID: 'missing_gameid',
  MISSING_PLAYERS: 'missing_players',
  TOO_FEW_PLAYERS: 'too_few_players',
  MISSING_USERNAME: 'missing_username',
  MISSING_CARDPILES: 'missing_cardpiles',
  HAND_NOT_ARRAY: 'hand_not_array',
  NO_VISIBLE_HAND: 'no_visible_hand',
  NO_ACTIVE_FLAG: 'no_active_flag',
  LEADER_NO_SETID: 'leader_no_setid',
  BASE_NO_SETID: 'base_no_setid',
};

// The beacon's entire vocabulary — the server validates incoming codes against
// this and drops anything else.
function knownIssueCodes() {
  return Object.keys(KB_ISSUE).map(function (k) { return KB_ISSUE[k]; });
}

// Codes that should hold even at match start (pre-mulligan / no action yet).
// These are the high-confidence drift signals the EXTENSION reports from the
// first gamestate. NO_VISIBLE_HAND / NO_ACTIVE_FLAG depend on game progression,
// so they're excluded from the early-frame beacon (the server-side cron over
// COMPLETED replays can use the full set).
function structuralIssueCodes() {
  return [
    KB_ISSUE.MISSING_SNAPSHOT, KB_ISSUE.MISSING_GAMEID, KB_ISSUE.MISSING_PLAYERS,
    KB_ISSUE.TOO_FEW_PLAYERS, KB_ISSUE.MISSING_USERNAME, KB_ISSUE.MISSING_CARDPILES,
    KB_ISSUE.HAND_NOT_ARRAY, KB_ISSUE.LEADER_NO_SETID, KB_ISSUE.BASE_NO_SETID,
  ];
}

// Returns { ok, issues: code[] } — issues deduped, drawn only from KB_ISSUE.
function validateKarabastGamestate(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, issues: [KB_ISSUE.MISSING_SNAPSHOT] };
  const issues = [];
  const add = function (code) { if (issues.indexOf(code) === -1) issues.push(code); };
  if (!snapshot.id) add(KB_ISSUE.MISSING_GAMEID);

  const players = snapshot.players;
  if (!players || typeof players !== 'object' || Array.isArray(players)) {
    add(KB_ISSUE.MISSING_PLAYERS);
    return { ok: false, issues: issues };
  }
  const pids = Object.keys(players);
  if (pids.length < 2) add(KB_ISSUE.TOO_FEW_PLAYERS);

  let anyVisibleHand = false;
  let anyActiveFlag = false;
  for (let i = 0; i < pids.length; i++) {
    const p = players[pids[i]] || {};
    if (!p.user || typeof p.user.username !== 'string') add(KB_ISSUE.MISSING_USERNAME);
    const piles = p.cardPiles;
    if (!piles || typeof piles !== 'object') {
      add(KB_ISSUE.MISSING_CARDPILES);
    } else if (!Array.isArray(piles.hand)) {
      add(KB_ISSUE.HAND_NOT_ARRAY);
    } else if (piles.hand.some(function (c) { return c && (c.id || c.setId); })) {
      anyVisibleHand = true;
    }
    if (Object.prototype.hasOwnProperty.call(p, 'isActionPhaseActivePlayer')) anyActiveFlag = true;
    if (p.leader && typeof p.leader === 'object' && !p.leader.setId) add(KB_ISSUE.LEADER_NO_SETID);
    if (p.base && typeof p.base === 'object' && !p.base.setId) add(KB_ISSUE.BASE_NO_SETID);
  }
  if (!anyVisibleHand) add(KB_ISSUE.NO_VISIBLE_HAND);
  if (!anyActiveFlag) add(KB_ISSUE.NO_ACTIVE_FLAG);

  return { ok: issues.length === 0, issues: issues };
}

// CJS export for the web app (skipped in the extension's classic content
// script, where `module` is undefined and the functions are already in scope).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateKarabastGamestate, knownIssueCodes, structuralIssueCodes };
}
