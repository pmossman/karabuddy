// Replay decoder — ported from the karabast-extension's 02-decoder.js
// playback path. Same algorithm; converted to TypeScript ES module so the
// hosted viewer can decode .karareplay payloads with no extension involved.

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// Recorder produces gamestate events as either {full: snapshot} or
// {patch: {path: value, ...}} where paths use '/' separators (a/b/c =
// state.a.b.c). Replay them in order to reconstruct each frame.
export function applyPatch(state: any, patch: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('/');
    let obj: any = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (!isPlainObject(obj[k])) obj[k] = {};
      obj = obj[k];
    }
    obj[parts[parts.length - 1]] = value;
  }
}

// Player-perspective recordings strip opponent hand cards down to stubs
// (no id/setId). Karabast's renderer would otherwise paint "UNKNOWN_EN
// IMAGE NOT FOUND". Replace each stub with a sentinel card we can style
// as a flat gray rectangle.
export const HIDDEN_SET = 'REPLAYHIDDEN';
export const HIDDEN_DATA_CARD_ID = `${HIDDEN_SET}_0`;

export function stripHiddenHandCards(state: any): any {
  if (!state?.players || typeof state.players !== 'object') return state;
  for (const pid of Object.keys(state.players)) {
    const player = state.players[pid];
    const piles = player?.cardPiles;
    if (!piles || !Array.isArray(piles.hand)) continue;
    piles.hand = piles.hand.map((c: any, i: number) => {
      if (c && (c.id || c.setId)) return c;
      return {
        controllerId: c?.controllerId,
        ownerId: c?.ownerId,
        zone: 'hand',
        uuid: `replay-hidden-${pid}-${i}`,
        selectable: false,
        id: HIDDEN_DATA_CARD_ID,
        setId: { set: HIDDEN_SET, number: 0 },
        name: '',
        type: 'basicUnit',
        printedType: 'basicUnit',
        aspects: [],
        isBlanked: false,
      };
    });
  }
  return state;
}

// Karabast reads promptState.* unconditionally; we strip it during
// recording to save bytes, so inject an empty well-formed default for
// each player on every frame.
const EMPTY_PROMPT_STATE = Object.freeze({
  selectCardMode: false,
  selectOrder: false,
  distributeAmongTargets: null,
  dropdownListOptions: [],
  menuTitle: '',
  promptTitle: '',
  buttons: [],
  promptUuid: null,
  promptType: '',
  displayCards: [],
  perCardButtons: [],
  isOpponentEffect: false,
  playerIsNewlyActive: false,
});

export function injectDefaultPromptState(state: any): any {
  if (!state?.players || typeof state.players !== 'object') return state;
  for (const pid of Object.keys(state.players)) {
    const p = state.players[pid];
    if (!p) continue;
    if (!p.promptState) p.promptState = { ...EMPTY_PROMPT_STATE };
  }
  return state;
}

export interface Frame {
  t: number;
  state: any;
}

export interface SideEvent {
  t: number;
  dir: string;
  event: string;
  args: any;
  frameIndex: number;
}

// B42: match metadata + per-user deck snapshots captured by the extension
// from karabast's lobbyState. Same shape that the server persists as JSONB
// columns on the replays table; embedded in the blob payload too so the
// shape is consistent across both data paths.
export interface MatchMeta {
  lobbyId?: string | null;
  lobbyName?: string | null;
  gameType?: string | null; // 'quick' | 'privateLobby' | etc.
  gameFormat?: string | null; // 'premier' | 'eternal' | 'open' | 'limited'
  cardPool?: string | null; // 'current' | 'nextSet' | 'unlimited'
  gamesToWinMode?: string | null; // 'bestOfOne' | 'bestOfThree'
  isPrivate?: boolean;
}

export interface DeckCardRef {
  id: string; // SET_NNN
  count: number;
  cost?: number | null;
  internalName?: string | null;
}

export interface UserDeck {
  username: string | null;
  name?: string | null;
  leader: DeckCardRef | null;
  base: DeckCardRef | null;
  // Local user has full deck + sideboard; opponent only has leader/base
  // (karabast masks). null on opponent for both fields.
  deck: DeckCardRef[] | null;
  sideboard: DeckCardRef[] | null;
}

export type DecksByUserId = Record<string, UserDeck>;

// B59: extract winner playerId(s) from a gamestate snapshot. Returns
// the array of winning playerIds (usually one in SWU; multi could
// indicate a team mode someday), or null if no winner signal is
// present yet. Mirrors the same shape detection the extension's
// 02-decoder.js uses for `looksLikeGameEnd` — karabast emits any of
// several fields depending on flow, so we check all of them.
//
// Server-side caller (POST /api/replays) walks the LAST gamestate in
// the events array and feeds it here. Per-frame extraction during
// playback isn't needed — the same final snapshot is what the user
// sees at game-end.
export function extractWinners(snapshot: any): string[] | null {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const pickStrings = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  };

  // Find the raw winner identifiers — karabast emits these as usernames
  // (e.g. ["ReprintConfiscate"]), NOT playerIds. We normalize to
  // playerIds below so callers can do `winners.includes(player.id)`.
  let raw: string[] | null = null;
  const direct = pickStrings(snapshot.winners);
  if (direct.length > 0) raw = direct;
  else if (typeof snapshot.winner === 'string' && snapshot.winner) raw = [snapshot.winner];
  else {
    for (const key of ['endGameInfo', 'endResult'] as const) {
      const block = (snapshot as any)[key];
      if (block && typeof block === 'object') {
        const arr = pickStrings(block.winners);
        if (arr.length > 0) { raw = arr; break; }
        const single = block.winnerId ?? block.winner;
        if (typeof single === 'string' && single) { raw = [single]; break; }
      }
    }
  }
  if (!raw || raw.length === 0) return null;

  // Normalize to playerIds. A raw value that already matches a key in
  // snapshot.players is treated as a playerId; otherwise resolve by
  // matching against the player's username. Unresolvable values pass
  // through untouched (best-effort — a username we can't find still
  // beats null).
  const players = snapshot.players && typeof snapshot.players === 'object'
    ? (snapshot.players as Record<string, any>)
    : null;
  if (!players) return raw;
  return raw.map((w) => {
    if (players[w]) return w;
    for (const [pid, p] of Object.entries(players)) {
      if (p?.user?.username === w) return pid;
    }
    return w;
  });
}

// Reconstruct the final gamestate from a parsed replay payload by
// applying all patches in order to the seed full snapshot. Necessary
// because karabast's recorder emits a single `{full: ...}` at start
// and then `{patch: {...}}` deltas for the rest of the match —
// reading just the last event gives you a delta object with no winner
// field. Returns null if the payload has no gamestate yet.
export function reconstructFinalState(parsed: any): any | null {
  const events = (parsed?.events as any[] | undefined) || [];
  let state: any = null;
  for (const e of events) {
    if (e?.event !== 'gamestate') continue;
    const arg = e?.args?.[0];
    if (!arg) continue;
    if (arg.full && typeof arg.full === 'object') {
      // Deep-clone so applyPatch's mutation doesn't poison subsequent
      // re-uses of the same payload (e.g. on upsert reprocessing).
      state = JSON.parse(JSON.stringify(arg.full));
    } else if (arg.patch && state) {
      applyPatch(state, arg.patch);
    }
  }
  return state;
}

// B65: scan every frame's gamestate for cards that appeared in a given
// player's VISIBLE zones (groundArena, spaceArena, discard, capturedZone,
// plus attached upgrades). Hand + deck + resources are masked/face-down
// and excluded. Dedupe by uuid so the same card appearing in many frames
// counts once; aggregate copies seen by card id.
export function extractSeenCards(frames: Frame[], playerId: string): DeckCardRef[] {
  const seenUuids = new Set<string>();
  const byCardId = new Map<string, { count: number; cost?: number | null }>();

  const addCard = (card: any) => {
    if (!card || !card.setId || !card.setId.set || card.setId.number == null) return;
    const uuid: string | undefined = card.uuid;
    if (uuid) {
      if (seenUuids.has(uuid)) return;
      seenUuids.add(uuid);
    }
    const id = `${card.setId.set}_${String(card.setId.number).padStart(3, '0')}`;
    const entry = byCardId.get(id);
    if (entry) {
      entry.count++;
    } else {
      byCardId.set(id, { count: 1, cost: card.cost ?? null });
    }
    if (Array.isArray(card.upgrades)) {
      for (const u of card.upgrades) addCard(u);
    }
  };

  for (const frame of frames) {
    const player = frame.state?.players?.[playerId];
    if (!player) continue;
    const piles = player.cardPiles || {};
    for (const zoneName of ['groundArena', 'spaceArena', 'discard', 'capturedZone'] as const) {
      const zone = piles[zoneName];
      if (Array.isArray(zone)) for (const c of zone) addCard(c);
    }
  }

  return Array.from(byCardId.entries()).map(([id, v]) => ({
    id,
    count: v.count,
    cost: v.cost ?? null,
  }));
}

export interface DecodedReplay {
  frames: Frame[];
  sideEvents: SideEvent[];
  activeByFrame: Array<string | null>;
  messagesByFrame: any[][];
  meta: {
    url?: string;
    startedAt?: string;
    durationMs?: number;
    reason?: string;
    version: number;
    // Player ID in gameState.players whose perspective this recording was
    // captured from. Set by the extension recorder; viewer renders this
    // player at the bottom of the board. Undefined on older replays
    // uploaded before the recorder started embedding it — viewer falls
    // back to first-player.
    localPlayerId?: string | null;
    // B42: lobby-state snapshot frozen at first gamestate. Both null on
    // replays uploaded by pre-B42 extension versions.
    match?: MatchMeta | null;
    decks?: DecksByUserId | null;
  };
  tags: Tag[];
}

export interface Tag {
  id: string;
  frameIndex: number;
  author: string;
  comment: string;
  createdAt: number;
}

export function decodeReplay(file: any): DecodedReplay {
  if (!file || typeof file !== 'object') throw new Error('Invalid replay file');
  if (file.version !== 1 && file.version !== 2) {
    throw new Error(`Unsupported replay version: ${file.version}`);
  }
  const events = Array.isArray(file.events) ? file.events : [];
  const frames: Frame[] = [];
  const sideEvents: SideEvent[] = [];
  let current: any = null;
  for (const e of events) {
    if (e.event === 'gamestate') {
      const arg = e.args?.[0];
      if (!arg) continue;
      if (file.version === 1) {
        current = structuredClone(arg);
      } else if (arg.full) {
        current = structuredClone(arg.full);
      } else if (arg.patch) {
        if (!current) throw new Error('Patch event before any full snapshot');
        applyPatch(current, arg.patch);
      } else {
        continue;
      }
      const snapshot = structuredClone(current);
      stripHiddenHandCards(snapshot);
      injectDefaultPromptState(snapshot);
      frames.push({ t: e.t, state: snapshot });
    } else {
      sideEvents.push({
        t: e.t,
        dir: e.dir,
        event: e.event,
        args: e.args,
        frameIndex: frames.length - 1,
      });
    }
  }
  const activeByFrame = frames.map((f) => {
    const players = f.state?.players;
    if (!players) return null;
    for (const pid of Object.keys(players)) {
      if (players[pid]?.isActionPhaseActivePlayer) return pid as string;
    }
    return null;
  });
  const messagesByFrame = frames.map((f) =>
    Array.isArray(f.state?.newMessages) ? f.state.newMessages : []
  );
  return {
    frames,
    sideEvents,
    activeByFrame,
    messagesByFrame,
    meta: {
      url: file.url,
      startedAt: file.startedAt,
      durationMs: file.durationMs,
      reason: file.reason,
      version: file.version,
      localPlayerId: typeof file.localPlayerId === 'string' ? file.localPlayerId : null,
      match: file.match || null,
      decks: file.decks || null,
    },
    tags: Array.isArray(file.tags) ? file.tags : [],
  };
}
