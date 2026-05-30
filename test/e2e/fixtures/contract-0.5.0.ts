// FROZEN extension↔server wire contract for the shipped 0.5.0 extension.
//
// ⚠️  DO NOT "update" these shapes to match the in-tree extension. This is
// the contract the CURRENTLY-PUBLISHED 0.5.0 sends — version-skew during
// CWS review means the live server must keep accepting it. If a server
// change requires editing anything here to stay green, that change is
// NOT backward-compatible with 0.5.0 → stop and make it additive instead.
//
// Captured from extension 0.5.0 (background.js + the payload 03-recorder
// produces). Notably absent — proving the server tolerates their absence:
//   • no top-level `shareTeamSlugs` on the upload (added in B71/8)
//   • no per-tag `teamSlugs` on embedded tags (added in B73)

// A minimal-but-valid .karareplay payload exactly as 0.5.0 emits it.
// `gameId` is injected per-call so repeated uploads in one test run don't
// collide on the snapshot-dedup path — everything else is frozen.
export function frozenUploadBody(installToken: string, gameId: string) {
  const localPlayerId = 'p-local-0.5.0';
  const opponentPlayerId = 'p-opp-0.5.0';
  const payload = JSON.stringify({
    version: 2,
    url: 'https://karabast.net/GameBoard',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 60000,
    reason: 'manual',
    actionCount: 1,
    localPlayerId,
    match: null,
    decks: null,
    events: [
      {
        t: 0,
        dir: 'in',
        event: 'gamestate',
        args: [
          {
            full: {
              id: gameId,
              players: {
                [localPlayerId]: {
                  user: { username: 'ContractLocal' },
                  leader: { id: 'ASH_005', setId: { set: 'ASH', number: 5 }, name: 'Luke Skywalker', type: 'leader', uuid: 'leader-local' },
                  base: { id: 'JTL_024', setId: { set: 'JTL', number: 24 }, name: 'Tarkintown', type: 'base', uuid: 'base-local' },
                  cardPiles: { hand: [{ id: 'ASH_005', setId: { set: 'ASH', number: 5 }, name: 'Luke', type: 'unit', uuid: 'card-1' }], deck: [], discard: [], resources: [], groundArena: [], spaceArena: [], capturedZone: [] },
                  isActionPhaseActivePlayer: true,
                },
                [opponentPlayerId]: {
                  user: { username: 'ContractOpp' },
                  leader: { id: 'ASH_014', setId: { set: 'ASH', number: 14 }, name: 'The Mandalorian', type: 'leader', uuid: 'leader-opp' },
                  base: { id: 'JTL_024', setId: { set: 'JTL', number: 24 }, name: 'Tarkintown', type: 'base', uuid: 'base-opp' },
                  cardPiles: { hand: [], deck: [], discard: [], resources: [], groundArena: [], spaceArena: [], capturedZone: [] },
                  isActionPhaseActivePlayer: false,
                },
              },
            },
          },
        ],
      },
    ],
    // 0.5.0 embeds in-game tags here — note: id/frameIndex/author/comment
    // (+ optional mentions), but NO teamSlugs. Real ids are globally unique
    // (makeTagId); derive from the unique gameId to mirror that and avoid PK
    // collisions across uploads in the shared E2E DB.
    tags: [{ id: `contract-tag-${gameId}`, frameIndex: 0, author: 'ContractLocal', comment: 'frozen 0.5.0 tag' }],
  });
  // 0.5.0's exact upload body: just { installToken, payload }.
  return { installToken, payload };
}

// 0.5.0's other request bodies (small enough to inline-freeze).
export const frozenClaimBody = (token: string) => ({ token });
export const frozenTeamShareBody = (teamSlug: string) => ({ teamSlug });
