// PROTOTYPE (throwaway — swuforge partnership, replay→replay conversion).
// Converts a karabuddy .karareplay payload into swuforge's PersistedTimeline v2
// blob (base snapshot + sparse objectDiff steps), the format Andy's REPLAY-BLOB-
// SPEC.md documents. Both sides derive from karabast/forceteki gamestate, so the
// mapping is a near-1:1 field normalization + upgrade-flattening.
//
// The payoff: swuforge handed us the reconstruction rule (applyPatch: objects
// merge, arrays/primitives replace). We port it here and ROUND-TRIP VERIFY the
// emitted blob folds back to the exact frames — proving validity on our side
// before Andy ever ingests it (mirrors karabuddy's forward-contract discipline).
//
// LOCAL ONLY (.env.development.local; payload blobs load read-only from prod Blob).
//   npx tsx scripts/prototype-replay-to-swuforge.ts [slug] [--v=2|3]

import { config } from 'dotenv';
config({ path: '.env.development.local' });

const isPlainObject = (v: any): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v);
const CARD_ID = (setId: any): string | null =>
  setId?.set && setId?.number != null ? `${setId.set}_${String(setId.number).padStart(3, '0')}` : null;

// ── karabast raw card → swuforge NormalizedCard ────────────────────────────
function normCard(c: any, parentCardId: string | null = null): any {
  return {
    uuid: c?.uuid ?? null,
    cardId: CARD_ID(c?.setId),
    karabastId: c?.id ?? null, // karabast engine template id
    name: c?.name ?? null,
    type: c?.type ?? null,
    printedType: c?.printedType ?? null,
    power: c?.power ?? null,
    hp: c?.hp ?? null,
    damage: c?.damage ?? 0,
    exhausted: !!c?.exhausted,
    isHidden: !c?.setId && !c?.id, // face-down/masked card (opp hand, resources)
    sentinel: !!c?.sentinel,
    isAttacker: !!c?.isAttacker,
    isDefender: !!c?.isDefender,
    cannotBeAttacked: !!c?.cannotBeAttacked,
    epicDeployActionSpent: !!c?.epicDeployActionSpent,
    epicActionSpent: !!c?.epicActionSpent,
    parentCardId,
  };
}

// karabuddy NESTS upgrades under host.upgrades[]; swuforge FLATTENS them as
// separate arena cards referencing the host via parentCardId. Flatten a zone.
function normZone(zone: any[]): any[] {
  const out: any[] = [];
  for (const card of zone || []) {
    out.push(normCard(card));
    for (const up of card?.upgrades || []) out.push(normCard(up, card?.uuid ?? null));
  }
  return out;
}

function normPlayer(p: any): any {
  const piles = p?.cardPiles || {};
  return {
    id: p?.id ?? null,
    name: p?.name ?? p?.user?.username ?? null,
    hasInitiative: !!p?.hasInitiative,
    availableResources: p?.availableResources ?? 0,
    credits: Array.isArray(p?.credits) ? p.credits.length : typeof p?.credits === 'number' ? p.credits : 0,
    numCardsInDeck: p?.numCardsInDeck ?? 0,
    aspects: Array.isArray(p?.aspects) ? p.aspects : [],
    isActionPhaseActivePlayer: !!p?.isActionPhaseActivePlayer,
    disconnected: !!p?.disconnected,
    leader: p?.leader ? normCard(p.leader) : null,
    base: p?.base ? normCard(p.base) : null,
    cardPiles: {
      hand: (piles.hand || []).map((c: any) => normCard(c)),
      resources: (piles.resources || []).map((c: any) => normCard(c)),
      groundArena: normZone(piles.groundArena),
      spaceArena: normZone(piles.spaceArena),
      discard: (piles.discard || []).map((c: any) => normCard(c)),
      outsideTheGame: (piles.outsideTheGame || []).map((c: any) => normCard(c)),
      capturedZone: (piles.capturedZone || []).map((c: any) => normCard(c)),
    },
    promptState: null, // karabuddy strips it; swuforge tolerates absent
  };
}

// Scrub every non-recorder handle → "Opponent" (privacy; matches swuforge's
// scrubPersistedOpponentName intent). karabuddy already masks opponent hidden
// cards, so name is the only PII in a board-only (v2) blob.
function normGamestate(s: any, meId: string | null, oppNames: Set<string>): any {
  const players: Record<string, any> = {};
  for (const pid of Object.keys(s?.players || {})) {
    const np = normPlayer(s.players[pid]);
    if (meId && pid !== meId) np.name = 'Opponent';
    players[pid] = np;
  }
  return {
    gameId: s?.id ?? null,
    phase: s?.phase ?? null,
    initiativeClaimed: !!s?.initiativeClaimed,
    // karabast winners are usernames; scrub the opponent's handle out.
    winners: Array.isArray(s?.winners) ? s.winners.map((w: string) => (oppNames.has(w) ? 'Opponent' : w)) : [],
    playerUpdate: null,
    players,
  };
}

// ── v3: karabast game-log (newMessages delta per frame) → swuforge chat ────
// karabast entry: { date, message: [ string | {type:'player',name,uuid,id} |
//   {type:'card',name,uuid,setId,controllerId} ] }  — OR an alert:
//   { message: { alert: { type, message: [...] } } }.
// swuforge ChatEntry: { ts, tokens: [ string | {kind:'player',name,uuid} |
//   {kind:'card',name,cardId,setId,controllerId} | {kind:'alert',text} ] }.
function scrubText(s: string, oppNames: Set<string>): string {
  let out = s;
  for (const n of oppNames) if (n) out = out.split(n).join('Opponent');
  return out;
}
function partToText(part: any, meId: string | null, oppNames: Set<string>): string {
  if (typeof part === 'string') return scrubText(part, oppNames);
  if (part?.type === 'player') return meId && part.id !== meId ? 'Opponent' : (part.name ?? '');
  if (part?.name) return part.name; // card token → its (public) card name
  return '';
}
function toChatToken(part: any, meId: string | null, oppNames: Set<string>): any {
  if (typeof part === 'string') return scrubText(part, oppNames);
  if (part?.type === 'player') {
    return { kind: 'player', name: meId && part.id !== meId ? 'Opponent' : (part.name ?? null), uuid: part.uuid ?? null };
  }
  // card token (has controllerId / setId)
  return {
    kind: 'card',
    name: part?.name ?? null, // card names in the log are public plays/reveals
    cardId: CARD_ID(part?.setId),
    setId: part?.setId ?? null,
    controllerId: part?.controllerId ?? null,
  };
}
function buildChat(frames: Array<{ t: number; state: any }>, meId: string | null, oppNames: Set<string>): any[] {
  const chat: any[] = [];
  for (const f of frames) {
    for (const m of f.state?.newMessages || []) {
      const ts = m?.date ? Date.parse(m.date) : (f.t ?? null);
      const msg = m?.message;
      if (msg && !Array.isArray(msg) && msg.alert) {
        const parts = Array.isArray(msg.alert.message) ? msg.alert.message : [msg.alert.message];
        const text = scrubText(parts.map((p: any) => partToText(p, meId, oppNames)).join(''), oppNames).trim();
        chat.push({ ts, tokens: [{ kind: 'alert', text }] });
      } else if (Array.isArray(msg)) {
        chat.push({ ts, tokens: msg.map((p: any) => toChatToken(p, meId, oppNames)) });
      }
    }
  }
  return chat;
}

// ── swuforge patch semantics (per REPLAY-BLOB-SPEC.md) ─────────────────────
// objectDiff: recurse into plain objects, replace arrays + primitives wholesale,
// never delete keys (karabast states are additive/overwrite).
function objectDiff(oldV: any, newV: any): any {
  const out: Record<string, any> = {};
  for (const k of Object.keys(newV)) {
    if (!(k in oldV)) { out[k] = newV[k]; continue; }
    if (JSON.stringify(oldV[k]) === JSON.stringify(newV[k])) continue;
    if (isPlainObject(oldV[k]) && isPlainObject(newV[k])) {
      const sub = objectDiff(oldV[k], newV[k]);
      if (Object.keys(sub).length) out[k] = sub;
    } else out[k] = newV[k];
  }
  return out;
}
// applyPatch: the documented reconstruction rule (objects merge, arrays/prims replace).
function applyPatch(state: any, patch: any): void {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (isPlainObject(v) && isPlainObject(state[k])) applyPatch(state[k], v);
    else state[k] = v;
  }
}

// Opponent handle strings to scrub from freeform log/winners (names + usernames
// of every non-recorder player). Player/card TOKENS scrub by id; this catches
// the plain-text leaks (alert lines, winners array).
function opponentNames(state: any, meId: string | null): Set<string> {
  const names = new Set<string>();
  for (const pid of Object.keys(state?.players || {})) {
    if (meId && pid === meId) continue;
    const p = state.players[pid];
    if (p?.name) names.add(p.name);
    if (p?.user?.username) names.add(p.user.username);
  }
  return names;
}

// Convert one decoded payload → PersistedTimeline (v2 board or v3 +chat) +
// round-trip verify the board. Returns the timeline plus verification stats.
function convertAndVerify(file: any, pov: string | null, version = 3) {
  const decodeReplay = (globalThis as any).__decodeReplay as (f: any) => any;
  const decoded = decodeReplay(file);
  const meId: string | null = decoded.meta.localPlayerId ?? pov ?? null;
  const frames = decoded.frames as Array<{ t: number; state: any }>;
  if (frames.length === 0) return { empty: true, meId, frames: 0 } as any;
  const oppNames = opponentNames(frames[0].state, meId);
  const normed = frames.map((f) => normGamestate(f.state, meId, oppNames));
  const base = normed[0];
  const startedMs = file.startedAt ? Date.parse(file.startedAt) : null;
  const steps = normed.slice(1).map((s, i) => ({
    capturedAt: null,
    timestamp: startedMs != null && frames[i + 1]?.t != null ? startedMs + frames[i + 1].t : (frames[i + 1]?.t ?? null),
    patch: objectDiff(normed[i], s),
  }));
  // Chat is a TOP-LEVEL array (not board state), so it doesn't affect the fold.
  const chat = version >= 3 ? buildChat(frames, meId, oppNames) : undefined;
  const timeline: any = { v: version, base, baseCapturedAt: file.startedAt ?? null, baseTimestamp: startedMs, steps };
  if (chat) timeline.chat = chat;

  let folded = JSON.parse(JSON.stringify(base));
  let mismatches = 0, firstBad = -1;
  const deepEq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 0; i < steps.length; i++) {
    applyPatch(folded, steps[i].patch);
    if (!deepEq(folded, normed[i + 1])) { mismatches++; if (firstBad < 0) firstBad = i + 1; }
  }
  return { empty: false, meId, timeline, frames: frames.length, steps: steps.length, mismatches, firstBad,
    chatEntries: chat?.length ?? 0,
    emptyPatches: steps.filter((s) => Object.keys(s.patch).length === 0).length };
}

async function fetchPayload(url: string): Promise<any> {
  const res = await fetch(url);
  const raw = Buffer.from(await res.arrayBuffer());
  try { return JSON.parse(raw.toString('utf8')); }
  catch { const z = await import('node:zlib'); return JSON.parse(z.gunzipSync(raw).toString('utf8')); }
}

async function main() {
  const args = process.argv.slice(2);
  const slugArg = args.find((a) => !a.startsWith('--'));
  const batchArg = args.find((a) => a.startsWith('--batch='));

  const { getDb } = await import('../lib/db');
  const { replays } = await import('../lib/schema');
  const { and, eq, isNotNull, desc, sql } = await import('drizzle-orm');
  const { decodeReplay } = await import('../lib/replayDecoder');
  (globalThis as any).__decodeReplay = decodeReplay;
  const db = getDb();

  // ── BATCH: convert + round-trip verify a random sample; report pass rate ──
  if (batchArg) {
    const n = Number(batchArg.split('=')[1]) || 100;
    const rows = await db.select({ slug: replays.slug, url: replays.payloadBlobUrl, size: replays.payloadSizeBytes, pov: replays.ownerPlayerId })
      .from(replays).where(and(eq(replays.encrypted, false), isNotNull(replays.ownerPlayerId)))
      .orderBy(sql`random()`).limit(n);
    let ok = 0, fail = 0, empty = 0, errored = 0, totalFrames = 0, totalChat = 0;
    const failures: string[] = [];
    let inGz = 0, outGz = 0;
    const zlib = await import('node:zlib');
    for (const r of rows) {
      try {
        const file = await fetchPayload(r.url);
        const res = convertAndVerify(file, r.pov, 3);
        if (res.empty) { empty++; continue; }
        totalFrames += res.frames;
        totalChat += res.chatEntries;
        inGz += r.size;
        outGz += zlib.gzipSync(Buffer.from(JSON.stringify(res.timeline))).length;
        if (res.mismatches === 0) ok++;
        else { fail++; failures.push(`${r.slug}: ${res.mismatches}/${res.steps} steps bad (first@${res.firstBad}, ${res.frames}f)`); }
      } catch (e: any) { errored++; failures.push(`${r.slug}: ERROR ${e.message?.slice(0, 80)}`); }
    }
    console.log(`\n── BATCH convert+verify (v3): ${rows.length} random replays ──`);
    console.log(`  ✅ board round-trip PASS:  ${ok}`);
    console.log(`  ❌ mismatch:               ${fail}`);
    console.log(`  ⚠️  errored:                ${errored}`);
    console.log(`  (empty/no-frames:         ${empty})`);
    console.log(`  frames converted: ${totalFrames}   chat entries mapped: ${totalChat}`);
    console.log(`  size: ${(inGz / 1024 / 1024).toFixed(1)}MB payloads in  →  ${(outGz / 1024).toFixed(0)}KB v3 blobs out (${rows.length - empty} games)`);
    if (failures.length) { console.log('\n  first 20 failures:'); failures.slice(0, 20).forEach((f) => console.log('   ', f)); }
    return;
  }

  const [row] = slugArg
    ? await db.select({ slug: replays.slug, url: replays.payloadBlobUrl, size: replays.payloadSizeBytes, pov: replays.ownerPlayerId, players: replays.players, decks: replays.decks }).from(replays).where(eq(replays.slug, slugArg))
    : await db.select({ slug: replays.slug, url: replays.payloadBlobUrl, size: replays.payloadSizeBytes, pov: replays.ownerPlayerId, players: replays.players, decks: replays.decks }).from(replays)
        .where(and(eq(replays.encrypted, false), isNotNull(replays.ownerPlayerId), isNotNull(replays.decks)))
        .orderBy(desc(replays.durationMs)).limit(1);
  if (!row) { console.log('No replay found.'); return; }

  const version = Number(args.find((a) => a.startsWith('--v='))?.split('=')[1]) || 3;
  const file = await fetchPayload(row.url);
  const r = convertAndVerify(file, row.pov, version);
  if (r.empty) { console.log(`${row.slug}: no frames.`); return; }
  const { timeline, meId, frames, steps, mismatches, firstBad, emptyPatches, chatEntries } = r;
  console.log(`slug=${row.slug}  payload=${(row.size / 1024).toFixed(0)}KB  version=${file.version}  frames=${frames}  meId=${meId}`);

  const zlib = await import('node:zlib');
  const json = JSON.stringify(timeline);
  const gz = zlib.gzipSync(Buffer.from(json));
  const scratch = '/private/tmp/claude-501/-Users-parker-code-karabuddy/80c7818e-be24-4ca7-98d0-e8717f134146/scratchpad';
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${scratch}/swuforge-${row.slug}.json`, JSON.stringify(timeline, null, 2));
  writeFileSync(`${scratch}/swuforge-${row.slug}.json.gz`, gz);

  console.log(`\n── PersistedTimeline v${version} emitted ──`);
  console.log(`  steps: ${steps}  (empty/no-op patches: ${emptyPatches})   chat entries: ${chatEntries}`);
  console.log(`  size:  ${(json.length / 1024).toFixed(0)}KB JSON  →  ${(gz.length / 1024).toFixed(1)}KB gzipped`);
  console.log(`  base players: ${Object.keys(timeline.base.players).join(', ')}`);
  console.log('\n── ROUND-TRIP VERIFICATION (fold via swuforge applyPatch) ──');
  console.log(mismatches === 0
    ? `  ✅ PASS — all ${frames} frames reconstruct byte-identical from base + steps`
    : `  ❌ ${mismatches} frame(s) mismatch (first at frame ${firstBad}) — mapping/patch bug`);

  const mePlayer = meId ? timeline.base.players[meId] : Object.values(timeline.base.players)[0];
  console.log('\n── sample: my leader (NormalizedCard) ──');
  console.log(JSON.stringify((mePlayer as any)?.leader, null, 1));
  if (version >= 3 && timeline.chat?.length) {
    console.log('\n── sample chat entries (scrubbed) ──');
    for (const c of timeline.chat.slice(0, 6)) console.log('  ', JSON.stringify(c).slice(0, 200));
  }
  console.log(`\nWrote ${scratch}/swuforge-${row.slug}.json(.gz)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
