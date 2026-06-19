// B170 / ADR 0010 — webapp ↔ extension bridge client (karabuddy origin).
//
// The webapp can't hold the team key (a poisoned deploy could grab it), so it
// asks the EXTENSION to decrypt/encrypt and to report its capabilities. This is
// the page-side half of the karabuddy-origin bridge: it postMessages a request
// to the content script (karabuddy-bridge.js), which relays it to the service
// worker and posts the reply back. Plaintext / envelopes / capability info cross
// this channel — the team KEY never does.
//
// CLIENT-ONLY: every function touches `window`, so import this from client
// components only. The pure helper `companionCapabilityState` is SSR-safe.

export interface CompanionInfo {
  version: string;
  capabilities: string[];
}

export type CompanionState = 'absent' | 'unsupported' | 'supported';

// Map the two detection signals to a feature-detection state (SSR-safe, pure):
//   info    — getCompanionInfo() result (null = the extension didn't answer the
//             NEW capability handshake, i.e. it's old or absent)
//   present — did ANY karabuddy extension answer the universal install-token
//             handshake? (every shipped build does — the claim flow). This is
//             what distinguishes "old extension installed" from "no extension".
// → has the capability: supported · present but no capability: unsupported
//   (too old — show "update") · nothing at all: absent (show "install").
export function companionCapabilityState(
  info: CompanionInfo | null,
  present = false,
  capability = 'privateTeams',
): CompanionState {
  if (info && Array.isArray(info.capabilities) && info.capabilities.includes(capability)) return 'supported';
  if (present || info) return 'unsupported';
  return 'absent';
}

// The access tier for rendering a (maybe-encrypted) replay in the webapp:
//   plaintext   — not encrypted; render normally (today's path)
//   absent      — encrypted, but no extension answered → "install the extension"
//   unsupported — extension present but too old → "update the extension"
//   needs-key   — extension OK, but this team's key isn't loaded → "load your key"
//   ready       — decrypt + render
export type PrivateReplayAccess = 'plaintext' | 'absent' | 'unsupported' | 'needs-key' | 'ready';

// Pure (SSR-safe) tier resolver: combines the replay's encryption state with the
// capability handshake + which keys are loaded. The gate UI maps each tier to a
// tailored, single-action prompt.
export function resolvePrivateReplayAccess(opts: {
  encrypted: boolean;
  teamKeyId: string | null;
  companion: CompanionInfo | null;
  present?: boolean;
  loadedKeyIds: string[];
}): PrivateReplayAccess {
  if (!opts.encrypted) return 'plaintext';
  const cap = companionCapabilityState(opts.companion, opts.present);
  if (cap !== 'supported') return cap; // 'absent' | 'unsupported'
  if (opts.teamKeyId && opts.loadedKeyIds.includes(opts.teamKeyId)) return 'ready';
  return 'needs-key';
}

const REQUEST_TYPE = 'karabuddy:companionRequest';
const RESULT_TYPE = 'karabuddy:companionResult';
let nextRequestId = 0;

// Low-level RPC: postMessage a request to the bridge, resolve with the SW's
// `data` (or reject on error / timeout). The bridge only relays an allowlisted
// set of request types, and never returns the key.
function companionRequest<T = unknown>(request: { type: string; [k: string]: unknown }, timeoutMs = 5000): Promise<T> {
  if (typeof window === 'undefined') return Promise.reject(new Error('companion: no window'));
  return new Promise<T>((resolve, reject) => {
    const requestId = `kb-${Date.now().toString(36)}-${++nextRequestId}`;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.type !== RESULT_TYPE || d.requestId !== requestId) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (d.ok) resolve(d.data as T);
      else reject(new Error(d.error || `companion request failed: ${request.type}`));
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('companion-timeout'));
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: REQUEST_TYPE, requestId, request }, window.location.origin);
  });
}

// Is ANY karabuddy extension installed? Uses the install-token handshake that
// EVERY shipped build answers (the account-claim flow) — so we can tell an OLD
// extension (present, but can't answer getCompanionInfo) from no extension at
// all, and word the gate "update" vs "install". Resolves false on timeout.
export function extensionPresent(timeoutMs = 1200): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = `kbtok-${Date.now().toString(36)}-${++nextRequestId}`;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.type !== 'karabuddy:installTokenResponse' || d.requestId !== requestId) return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(false);
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'karabuddy:requestInstallToken', requestId }, window.location.origin);
  });
}

// Handshake: who's the extension and what can it do? Resolves null when nothing
// answers in time (old extension OR absent) — pair with extensionPresent() to
// tell those apart. Short timeout: a present bridge replies in a few ms.
export async function getCompanionInfo(timeoutMs = 1200): Promise<CompanionInfo | null> {
  try {
    return await companionRequest<CompanionInfo>({ type: 'getCompanionInfo' }, timeoutMs);
  } catch {
    return null;
  }
}

// Ask the extension to decrypt an envelope under a team key it holds. Returns
// the plaintext string. Rejects with 'no-key' when the key isn't loaded.
export async function decryptForTeam(teamKeyId: string, envelope: unknown): Promise<string> {
  const { plaintext } = await companionRequest<{ plaintext: string }>({ type: 'decryptForTeam', teamKeyId, envelope }, 8000);
  return plaintext;
}

// Ask the extension to encrypt plaintext (e.g. a tag comment) under a team key.
// Returns the envelope object to POST. Keeps the key out of the page on writes.
export async function encryptForTeam(teamKeyId: string, plaintext: string): Promise<unknown> {
  const { envelope } = await companionRequest<{ envelope: unknown }>({ type: 'encryptForTeam', teamKeyId, plaintext }, 8000);
  return envelope;
}

// B170 / ADR 0010 — key rotation. Ask the extension to re-wrap an envelope's
// data key from the old team key to the new one (both held in the extension).
// Returns the re-wrapped envelope to store. The keys never enter the page;
// rejects with 'no-key' if either key isn't loaded on this device.
export async function rewrapForTeam(
  oldTeamKeyId: string,
  newTeamKeyId: string,
  envelope: unknown,
): Promise<unknown> {
  const { envelope: rewrapped } = await companionRequest<{ envelope: unknown }>(
    { type: 'rewrapForTeam', oldTeamKeyId, newTeamKeyId, envelope },
    8000,
  );
  return rewrapped;
}

// A single replay's re-wrapped envelopes, ready to POST to /rewrap.
export interface RewrappedReplay {
  slug: string;
  payload: string;
  encryptedSummary: string;
  tags: { id: string; commentEncrypted: string }[];
}

// One manifest entry (mirrors the rotation-manifest endpoint).
export interface RotationReplay {
  slug: string;
  payloadBlobUrl: string;
  encryptedSummary: string | null;
  tags: { id: string; commentEncrypted: string }[];
}

// Re-wrap ALL of a replay's ciphertext (payload blob + summary + encrypted tag
// comments) old→new key, asking the extension per envelope. Pure-ish: fetches
// the blob, calls the bridge; returns the strings the /rewrap endpoint expects.
export async function rewrapReplay(
  oldTeamKeyId: string,
  newTeamKeyId: string,
  replay: RotationReplay,
): Promise<RewrappedReplay> {
  const res = await fetch(replay.payloadBlobUrl);
  if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
  const payloadEnv = await res.json();
  const payload = JSON.stringify(await rewrapForTeam(oldTeamKeyId, newTeamKeyId, payloadEnv));

  const summaryEnv = replay.encryptedSummary ? JSON.parse(replay.encryptedSummary) : null;
  const encryptedSummary = summaryEnv
    ? JSON.stringify(await rewrapForTeam(oldTeamKeyId, newTeamKeyId, summaryEnv))
    : '';

  const tags: { id: string; commentEncrypted: string }[] = [];
  for (const t of replay.tags) {
    const env = JSON.parse(t.commentEncrypted);
    tags.push({ id: t.id, commentEncrypted: JSON.stringify(await rewrapForTeam(oldTeamKeyId, newTeamKeyId, env)) });
  }
  return { slug: replay.slug, payload, encryptedSummary, tags };
}

// Ask the extension to open its own trusted key-management page (a
// chrome-extension:// tab) — so the webapp's "load your key" gate can launch it
// without the user hunting for the toolbar icon. Only works when a supporting
// extension is present (which is exactly when the needs-key gate shows).
//
// `makePrivate` deep-links the manager to a focused "generate the key for THIS
// team to turn private mode on" panel — so minting the first key is coupled to
// the enable action (Settings) rather than a freestanding act on a team that
// isn't private yet. The extension re-verifies ownership + non-private state.
export async function openKeyManager(opts?: { makePrivate?: string }): Promise<boolean> {
  try {
    await companionRequest(
      { type: 'openKeyManager', ...(opts?.makePrivate ? { makePrivate: opts.makePrivate } : {}) },
      3000,
    );
    return true;
  } catch {
    return false;
  }
}

// Which private-team keys are loaded in the extension (non-secret kids only).
export async function loadedTeamKeyIds(): Promise<string[]> {
  try {
    return await companionRequest<string[]>({ type: 'listPrivateTeamKeyIds' }, 3000);
  } catch {
    return [];
  }
}

// Loaded keys WITH their local names (non-secret) — for the owner's private-mode
// toggle picker, so it shows "Worlds Squad" rather than a raw key id.
export async function loadedTeamKeys(): Promise<{ teamKeyId: string; name: string | null }[]> {
  try {
    return await companionRequest<{ teamKeyId: string; name: string | null }[]>({ type: 'listPrivateTeamKeys' }, 3000);
  } catch {
    return [];
  }
}

// Decrypt a stored encrypted summary (the `encrypted_summary` column, a
// JSON-stringified envelope) → the matchup summary object the list/viewer render.
export async function decryptSummary<T = unknown>(teamKeyId: string, encryptedSummary: string): Promise<T> {
  const envelope = JSON.parse(encryptedSummary);
  return JSON.parse(await decryptForTeam(teamKeyId, envelope)) as T;
}

// Fetch an encrypted replay's ciphertext blob and decrypt it → the plaintext
// payload object (same shape the plaintext viewer consumes). The envelope is the
// blob body; the key never leaves the extension.
export async function decryptReplayPayload<T = unknown>(teamKeyId: string, blobUrl: string): Promise<T> {
  const res = await fetch(blobUrl);
  if (!res.ok) throw new Error(`payload fetch failed: ${res.status}`);
  const envelope = await res.json();
  return JSON.parse(await decryptForTeam(teamKeyId, envelope)) as T;
}

// Decrypt the ciphertext comments on web-authored tags of a private replay (the
// `commentEncrypted` field) into the plaintext `comment` for display. Best-effort
// per tag: a tag that won't decrypt (lost/rotated key) shows a placeholder rather
// than failing the whole list. Tags without `commentEncrypted` pass through.
export async function hydrateEncryptedTags<T extends { comment: string; commentEncrypted?: string | null }>(
  tags: T[],
  teamKeyId: string,
): Promise<T[]> {
  return Promise.all(
    tags.map(async (t) => {
      if (!t.commentEncrypted) return t;
      try {
        return { ...t, comment: await decryptForTeam(teamKeyId, JSON.parse(t.commentEncrypted)) };
      } catch {
        return { ...t, comment: '🔒 (encrypted — load your team key to read)' };
      }
    }),
  );
}
