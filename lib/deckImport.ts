// B124: server-side decklist import for tournament registration. Ported from
// karabast's /api/swudbdeck route (forceteki-client, MIT) but restructured as
// a declarative source table instead of an if-chain, plus response VALIDATION
// karabast skips (we persist the result as a frozen snapshot, so garbage in
// would be garbage forever).
//
// Every supported site exposes a karabast-interop JSON endpoint returning the
// same IDeckData shape ({metadata{name}, leader{id,count}, secondleader, base,
// deck[], sideboard[]}), so there is no per-source transform — only per-source
// link parsing + error mapping. swudb.com itself has no such endpoint (same
// gap upstream) and is rejected as unsupported.

import type { TournamentDeck, TournamentDeckCard } from '@/lib/schema';

export interface DeckImportSuccess {
  ok: true;
  deckName: string | null;
  deck: TournamentDeck;
  deckSource: string;
  deckId: string;
}
export interface DeckImportFailure {
  ok: false;
  status: number; // suggested HTTP status for the caller
  error: string;
}
export type DeckImportResult = DeckImportSuccess | DeckImportFailure;

interface SourceDef {
  source: string;
  hostMatch: string;
  // Extract the site's deck id from the pasted link; null = unparseable.
  extractId: (link: string) => string | null;
  apiUrl: (id: string) => string;
  // Map an upstream non-OK status to a friendly {status, error}; fall through
  // to a generic 502 for anything unmapped.
  errorMap?: Record<number, { status: number; error: string }>;
  invalidLinkHint?: string;
}

const lastPathSegment = (re: RegExp) => (link: string) => {
  const m = link.match(re);
  return m ? m[1] : null;
};

const SOURCES: SourceDef[] = [
  {
    source: 'SWUStats',
    hostMatch: 'swustats.net',
    extractId: lastPathSegment(/gameName=([^&]+)/),
    apiUrl: (id) => `https://swustats.net/TCGEngine/APIs/LoadDeck.php?deckID=${id}&format=json&setId=true`,
    errorMap: {
      404: { status: 404, error: 'Deck not found. Make sure the deck exists on swustats.net.' },
      500: { status: 404, error: 'Deck not found. Make sure the deck exists on swustats.net.' },
    },
  },
  {
    source: 'SWUnlimitedDB',
    hostMatch: 'sw-unlimited-db.com',
    extractId: lastPathSegment(/\/decks\/(\d+)\/?$/),
    apiUrl: (id) => `https://sw-unlimited-db.com/umbraco/api/deckapi/get?id=${id}`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure it is set to Published on sw-unlimited-db.' } },
  },
  {
    source: 'SWUCardHub',
    hostMatch: 'swucardhub.fr',
    extractId: lastPathSegment(/\/Karabast\/(\d+)\/?$/),
    apiUrl: (id) => `https://swucardhub.fr/Karabast/${id}`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure it is set to Published on swucardhub.fr.' } },
  },
  {
    source: 'SWUBase',
    hostMatch: 'swubase.com',
    extractId: lastPathSegment(/\/decks\/([^/]+?)\/?$/),
    apiUrl: (id) => `https://swubase.com/api/deck/${id}/json`,
    // SWUBase 404s private decks; surface as 403 so the message lands.
    errorMap: { 404: { status: 403, error: 'Deck not found. Make sure the deck is set to Public on swubase.com.' } },
  },
  {
    source: 'SWUMetaStats',
    hostMatch: 'swumetastats.com',
    extractId: lastPathSegment(/\/decklists\/([^/]+?)\/?$/),
    apiUrl: (id) => `https://www.swumetastats.com/api/decklists/${id}/json`,
  },
  {
    source: 'MySWU',
    hostMatch: 'my-swu.com',
    extractId: (link) => {
      const m = link.split('?')[0].match(/\/decks\/(?:me\/|explore\/[^/]+\/)?([^/]+?)\/?$/);
      return m ? m[1] : null;
    },
    apiUrl: (id) => `https://my-swu.com/api/decks/${id}/json`,
    errorMap: { 404: { status: 403, error: 'Deck not found. Make sure the deck is set to Public or Unlisted on my-swu.com.' } },
  },
  {
    source: 'ProtectThePod',
    hostMatch: 'protectthepod.com',
    extractId: lastPathSegment(/\/pool\/([a-zA-Z0-9_-]+)/),
    apiUrl: (id) => `https://protectthepod.com/api/pools/${encodeURIComponent(id)}/deck.json`,
    errorMap: {
      400: { status: 404, error: 'No deck has been built for this pool yet. Build a deck on protectthepod.com first, then share the link.' },
      404: { status: 404, error: 'Pool not found on protectthepod.com.' },
    },
    invalidLinkHint: 'Share a pool or deck builder link from protectthepod.com.',
  },
  {
    source: 'SWUForge',
    hostMatch: 'swuforge.com',
    extractId: lastPathSegment(/\/decks\/([^/]+?)\/?$/),
    apiUrl: (id) => `https://swuforge.com/api/decks/${id}/json`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure the deck exists on swuforge.com.' } },
  },
  {
    source: 'KyberDecks',
    hostMatch: 'kyberdecks.com',
    extractId: lastPathSegment(/\/decks\/([^/]+?)\/?$/),
    apiUrl: (id) => `https://exportdeck.kyberdecks.com/api/deck-export?id=${id}`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure the deck exists on kyberdecks.com.' } },
  },
  {
    source: 'CardCore',
    hostMatch: 'cardcore.gg',
    extractId: lastPathSegment(/\/decks\/(\d+)\/?$/),
    apiUrl: (id) => `https://store.cardcore.gg/api/decks/${id}/json`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure the deck is set to Public on cardcore.gg.' } },
  },
  {
    source: 'HoloScan',
    hostMatch: 'holoscan.net',
    extractId: lastPathSegment(/\/decks\/([^/]+?)\/?$/),
    apiUrl: (id) => `https://holoscan.net/api/decks/${id}`,
    errorMap: { 404: { status: 404, error: 'Deck not found. Make sure the deck exists on holoscan.net.' } },
  },
];

// 'SOR_010', 'JTL_024b', 'SHD_123' — set code + number, tolerant of a trailing
// variant letter. Anything weirder gets rejected rather than snapshotted.
const CARD_ID_RE = /^[A-Za-z0-9]{2,8}_\d{1,4}[A-Za-z]?$/;
const MAX_DECK_ENTRIES = 200;
const MAX_SIDEBOARD_ENTRIES = 100;
const MAX_COUNT = 30;

function sanitizeCard(raw: unknown): TournamentDeckCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String((raw as any).id ?? '').trim();
  const count = Number((raw as any).count);
  if (!CARD_ID_RE.test(id)) return null;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
  return { id, count };
}

function sanitizeList(raw: unknown, max: number): TournamentDeckCard[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > max) return null;
  const out: TournamentDeckCard[] = [];
  for (const entry of raw) {
    const card = sanitizeCard(entry);
    if (!card) return null; // one bad entry rejects the import — no silent drops
    out.push(card);
  }
  return out;
}

export function deckSourceFor(deckLink: string): SourceDef | null {
  return SOURCES.find((s) => deckLink.includes(s.hostMatch)) ?? null;
}

export async function importDeck(deckLink: string): Promise<DeckImportResult> {
  const trimmed = String(deckLink || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'Missing deck link' };
  if (trimmed.length > 500) return { ok: false, status: 400, error: 'Deck link is too long' };

  const def = deckSourceFor(trimmed);
  if (!def) {
    return { ok: false, status: 400, error: 'Deckbuilder not supported. Supported: swustats, swubase, my-swu, swuforge, kyberdecks, and others with a karabast export.' };
  }
  const id = def.extractId(trimmed);
  if (!id) {
    return { ok: false, status: 400, error: def.invalidLinkHint ?? 'Invalid deck link format' };
  }

  let res: Response;
  try {
    res = await fetch(def.apiUrl(id), { method: 'GET', cache: 'no-store' });
  } catch {
    return { ok: false, status: 502, error: `Could not reach ${def.source} — try again later.` };
  }
  if (!res.ok) {
    const mapped = def.errorMap?.[res.status];
    if (mapped) return { ok: false, ...mapped };
    return { ok: false, status: 502, error: `${def.source} returned an error (${res.status}) — try again later.` };
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: 502, error: `${def.source} returned an unreadable response.` };
  }

  const leader = sanitizeCard(data?.leader);
  const base = sanitizeCard(data?.base);
  const secondleader = data?.secondleader ? sanitizeCard(data.secondleader) : null;
  const deck = sanitizeList(data?.deck, MAX_DECK_ENTRIES);
  const sideboard = sanitizeList(data?.sideboard, MAX_SIDEBOARD_ENTRIES);
  if (!leader || !base || deck === null || sideboard === null || deck.length === 0) {
    return { ok: false, status: 422, error: `${def.source} returned a deck we couldn't understand (missing or malformed leader/base/cards).` };
  }

  const rawName = data?.metadata?.name;
  const deckName = typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 120) : null;

  return {
    ok: true,
    deckName,
    deck: { leader, base, ...(secondleader ? { secondleader } : {}), deck, sideboard },
    deckSource: def.source,
    deckId: id,
  };
}
