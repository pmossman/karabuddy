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
function normCard(c: any): any {
  // Masked/face-down cards: the opponent's hidden hand (karabuddy's decoder
  // replaces these with a REPLAYHIDDEN sentinel that still carries a setId/id)
  // and face-down resources (no identity at all). swuforge draws card BACKS off
  // `isHidden`, so emit a true hidden card with NO cardId — else the sentinel
  // 404s as broken art (Andy's verify finding). See docs/swuforge-migration.
  const masked = c?.setId?.set === 'REPLAYHIDDEN' || c?.id === 'REPLAYHIDDEN_0' || (!c?.setId && !c?.id);
  return {
    uuid: c?.uuid ?? null,
    cardId: masked ? null : CARD_ID(c?.setId),
    karabastId: masked ? null : (c?.id ?? null), // karabast engine template id
    name: masked ? null : (c?.name ?? null),
    type: c?.type ?? null,
    printedType: c?.printedType ?? null,
    power: c?.power ?? null,
    hp: c?.hp ?? null,
    damage: c?.damage ?? 0,
    exhausted: !!c?.exhausted,
    isHidden: masked, // face-down/masked card (opp hand, resources) → card back
    sentinel: !!c?.sentinel,
    isAttacker: !!c?.isAttacker,
    isDefender: !!c?.isDefender,
    cannotBeAttacked: !!c?.cannotBeAttacked,
    epicDeployActionSpent: !!c?.epicDeployActionSpent,
    epicActionSpent: !!c?.epicActionSpent,
    // karabast already stores an upgrade as a SEPARATE arena card carrying
    // parentCardId = its host's uuid — swuforge's exact model. Carry it through
    // (no flatten needed; the earlier "nested upgrades" assumption was wrong).
    parentCardId: c?.parentCardId ?? null,
  };
}

// Arena cards (units AND their attached upgrades) map straight across — upgrades
// are already separate cards with parentCardId, not nested under a host.
function normZone(zone: any[]): any[] {
  return (zone || []).map((c) => normCard(c));
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
// Scrub config: which playerId → forced display label, and which raw handle
// strings → their label (for freeform winners/alert text). Built per-game.
interface Scrub { labelById: Map<string, string>; replaceMap: Map<string, string>; }

// Default (real migration): keep the recorder's handle, scrub the opponent.
// anon=true (sample handoff of other users' games): scrub BOTH → Recorder/Opponent.
function buildScrub(state: any, meId: string | null, anon: boolean): Scrub {
  const labelById = new Map<string, string>();
  const replaceMap = new Map<string, string>();
  for (const pid of Object.keys(state?.players || {})) {
    const p = state.players[pid];
    const isMe = meId != null && pid === meId;
    const label = isMe ? (anon ? 'Recorder' : null) : 'Opponent';
    if (!label) continue;
    labelById.set(pid, label);
    for (const h of [p?.name, p?.user?.username]) if (h) replaceMap.set(h, label);
  }
  return { labelById, replaceMap };
}

function normGamestate(s: any, scrub: Scrub): any {
  const players: Record<string, any> = {};
  for (const pid of Object.keys(s?.players || {})) {
    const np = normPlayer(s.players[pid]);
    const label = scrub.labelById.get(pid);
    if (label) np.name = label;
    players[pid] = np;
  }
  return {
    gameId: s?.id ?? null,
    phase: s?.phase ?? null,
    initiativeClaimed: !!s?.initiativeClaimed,
    // karabast winners are usernames; map any scrubbed handle → its label.
    winners: Array.isArray(s?.winners) ? s.winners.map((w: string) => scrub.replaceMap.get(w) ?? w) : [],
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
function scrubText(s: string, replaceMap: Map<string, string>): string {
  let out = s;
  for (const [h, label] of replaceMap) if (h) out = out.split(h).join(label);
  return out;
}
function playerTokenName(part: any, scrub: Scrub): string | null {
  return scrub.labelById.get(part?.id) ?? part?.name ?? null;
}
function partToText(part: any, scrub: Scrub): string {
  if (typeof part === 'string') return scrubText(part, scrub.replaceMap);
  if (part?.type === 'player') return playerTokenName(part, scrub) ?? '';
  if (part?.name) return part.name; // card token → its (public) card name
  return '';
}
function toChatToken(part: any, scrub: Scrub): any {
  if (typeof part === 'string') return scrubText(part, scrub.replaceMap);
  if (part?.type === 'player') {
    return { kind: 'player', name: playerTokenName(part, scrub), uuid: part?.uuid ?? null };
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
function buildChat(frames: Array<{ t: number; state: any }>, scrub: Scrub): any[] {
  const chat: any[] = [];
  for (const f of frames) {
    for (const m of f.state?.newMessages || []) {
      const ts = m?.date ? Date.parse(m.date) : (f.t ?? null);
      const msg = m?.message;
      if (msg && !Array.isArray(msg) && msg.alert) {
        const parts = Array.isArray(msg.alert.message) ? msg.alert.message : [msg.alert.message];
        const text = scrubText(parts.map((p: any) => partToText(p, scrub)).join(''), scrub.replaceMap).trim();
        chat.push({ ts, tokens: [{ kind: 'alert', text }] });
      } else if (Array.isArray(msg)) {
        chat.push({ ts, tokens: msg.map((p: any) => toChatToken(p, scrub)) });
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

// Convert one decoded payload → PersistedTimeline (v2 board or v3 +chat) +
// round-trip verify the board. Returns the timeline plus verification stats.
// anon=true fully anonymizes both players (for a sample handoff of others' games).
function convertAndVerify(file: any, pov: string | null, version = 3, anon = false) {
  const decodeReplay = (globalThis as any).__decodeReplay as (f: any) => any;
  const decoded = decodeReplay(file);
  const meId: string | null = decoded.meta.localPlayerId ?? pov ?? null;
  const frames = decoded.frames as Array<{ t: number; state: any }>;
  if (frames.length === 0) return { empty: true, meId, frames: 0 } as any;
  const scrub = buildScrub(frames[0].state, meId, anon);
  const normed = frames.map((f) => normGamestate(f.state, scrub));
  const base = normed[0];
  const startedMs = file.startedAt ? Date.parse(file.startedAt) : null;
  const steps = normed.slice(1).map((s, i) => ({
    capturedAt: null,
    timestamp: startedMs != null && frames[i + 1]?.t != null ? startedMs + frames[i + 1].t : (frames[i + 1]?.t ?? null),
    patch: objectDiff(normed[i], s),
  }));
  // Chat is a TOP-LEVEL array (not board state), so it doesn't affect the fold.
  const chat = version >= 3 ? buildChat(frames, scrub) : undefined;
  const timeline: any = { v: version, base, baseCapturedAt: file.startedAt ?? null, baseTimestamp: startedMs, steps };
  if (chat) timeline.chat = chat;

  let folded = JSON.parse(JSON.stringify(base));
  let mismatches = 0, firstBad = -1;
  const deepEq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
  for (let i = 0; i < steps.length; i++) {
    applyPatch(folded, steps[i].patch);
    if (!deepEq(folded, normed[i + 1])) { mismatches++; if (firstBad < 0) firstBad = i + 1; }
  }
  const hasUpgrades = normed.some((g: any) => Object.values(g.players).some((p: any) =>
    ['groundArena', 'spaceArena'].some((z) => (p.cardPiles[z] || []).some((c: any) => c.parentCardId))));
  return { empty: false, meId, timeline, frames: frames.length, steps: steps.length, mismatches, firstBad,
    chatEntries: chat?.length ?? 0, hasUpgrades,
    emptyPatches: steps.filter((s) => Object.keys(s.patch).length === 0).length };
}

// README for the sample pack — tailored to Andy, mirrors his REPLAY-BLOB-SPEC.md.
function buildPackReadme(manifest: any[]): string {
  const rows = manifest.map((m) =>
    `| \`${m.file}\` | ${m.matchup} | ${m.frames} | ${m.chat} | ${m.hasUpgrades ? 'yes' : '—'} | ${m.gzKB} KB |`).join('\n');
  return `# karabuddy → swuforge: sample converted replays

These are **real karabuddy replays converted into your \`PersistedTimeline\` v3
format** (\`REPLAY-BLOB-SPEC.md\`). The mirror of what you sent us — one \`.json.gz\`
per game (your stored shape) plus a pretty \`.json\` for reading.

**Please try loading a couple in your renderer** — that's the one thing we can't
verify on our side (below). If they render, the whole pipe is proven.

## What these are

karabuddy records the raw karabast/forceteki gamestate over a match (a \`{full}\`
seed + \`{patch}\` deltas). Since your \`PersistedTimeline\` is a normalized version
of the *same* gamestate, converting is a field normalization, not a translation:

- \`setId:{set,number}\` → \`cardId:"SET_NNN"\`; card engine \`id\` → \`karabastId\`;
  \`uuid\`/\`name\`/\`type\`/\`printedType\`/\`power\`/\`hp\`/\`damage\`/\`exhausted\`/\`sentinel\`/
  \`isAttacker\`/\`isDefender\`/\`cannotBeAttacked\`/\`epicDeployActionSpent\` map directly.
- **Upgrades:** karabast already stores them as separate arena cards carrying
  \`parentCardId = host.uuid\` — your exact model — so they carry straight across,
  no transform. The "upgrades?" column flags which samples contain one.
- **Chat (v3):** karabast's game log → your \`chat:[{ts,tokens[]}]\` — \`string\` /
  \`{kind:'player',name,uuid}\` / \`{kind:'card',name,cardId,setId,controllerId}\` /
  \`{kind:'alert',text}\`.
- **Steps:** \`base\` = frame 0; each \`steps[i].patch\` = object-diff of consecutive
  normalized frames (objects merge, arrays/primitives replace — your \`applyPatch\`).

## We round-trip verified every one of these

Before writing each blob we fold \`base + steps\` back using **your documented
\`applyPatch\` rule** and assert it reconstructs every frame byte-identical. So
these are guaranteed valid + foldable. What we **can't** verify without your UI:
that they *render* correctly (esp. upgrades attaching to the right host via
\`parentCardId\`) — hence the ask.

## Privacy

**Fully anonymized** — unlike a real user migration (which keeps the recorder's
handle as the perspective), these are diverse users' games, so BOTH handles are
scrubbed: recorder → \`"Recorder"\`, opponent → \`"Opponent"\` (player names, chat
player tokens, winners, alert text). karabast already masks opponents' hidden
cards, so only face-up, publicly-played board cards carry identity.

## The files

| file | matchup (anonymized) | frames | chat | upgrades? | size |
|---|---|---|---|---|---|
${rows}

Each carries \`v:3, base, steps[], chat[]\`. The "me"/perspective (a playerId)
travels *outside* the blob in your model — say the word and we'll include which
\`players[id]\` is the recorder for each.

## A few questions (so we can pick the handoff shape)

1. Do these **load + render** in your viewer as-is? Anything off (upgrades, zones,
   card art, chat)?
2. Is **v3 enough**, or does your renderer expect v4 ledgers (credits/force/
   bounces)? We can derive those from the same chat.
3. **Handoff mechanic:** blob POSTed to an endpoint, dropped in your R2
   (\`games/{profileId}/{gameId}.json.gz\`), or fetched from a karabuddy URL?
4. **Identity:** OK to match a user across apps by shared Google/Discord so a
   pushed replay lands in the right swuforge profile automatically?
`;
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
  const packArg = args.find((a) => a === '--pack' || a.startsWith('--pack='));
  const SCRATCH = '/private/tmp/claude-501/-Users-parker-code-karabuddy/80c7818e-be24-4ca7-98d0-e8717f134146/scratchpad';

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

  // ── PACK: build an anonymized sample of diverse converted replays + README, ──
  // ── mirroring Andy's handoff; leaves a dir ready to zip. ─────────────────────
  if (packArg) {
    const N = Number(packArg.split('=')[1]) || 5;
    const dir = `${SCRATCH}/swuforge-sample-pack`;
    const fs = await import('node:fs');
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const zlib = await import('node:zlib');
    // Candidates: own-POV, decodable, substantial-but-not-huge; distinct own-leaders → variety.
    const cands = await db.select({ slug: replays.slug, url: replays.payloadBlobUrl, size: replays.payloadSizeBytes, pov: replays.ownerPlayerId, players: replays.players })
      .from(replays)
      .where(and(eq(replays.encrypted, false), isNotNull(replays.ownerPlayerId), isNotNull(replays.decks),
        sql`${replays.payloadSizeBytes} between 60000 and 450000`))
      .orderBy(sql`random()`).limit(N * 10);
    const manifest: any[] = [];
    const seenLeaders = new Set<string>();
    console.log(`Building sample pack (target ${N} distinct-leader games)…`);
    for (const c of cands) {
      if (manifest.length >= N) break;
      const players = Array.isArray(c.players) ? (c.players as any[]) : [];
      const owner = players.find((p) => p?.id === c.pov);
      const opp = players.find((p) => p?.id !== c.pov);
      const leaderName = owner?.leader?.name ?? '?';
      if (seenLeaders.has(leaderName)) continue;
      let file: any; try { file = await fetchPayload(c.url); } catch { continue; }
      const res = convertAndVerify(file, c.pov, 3, true); // anon
      if (res.empty || res.mismatches > 0 || res.frames < 8) continue;
      seenLeaders.add(leaderName);
      const gid = String(res.timeline.base.gameId || c.slug).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      const fname = `karabuddy-replay-${gid}`;
      const json = JSON.stringify(res.timeline);
      const gz = zlib.gzipSync(Buffer.from(json));
      fs.writeFileSync(`${dir}/${fname}.json`, JSON.stringify(res.timeline, null, 2));
      fs.writeFileSync(`${dir}/${fname}.json.gz`, gz);
      const matchup = `${owner?.leader?.name ?? '?'} · ${owner?.base?.name ?? '?'} vs ${opp?.leader?.name ?? '?'} · ${opp?.base?.name ?? '?'}`;
      manifest.push({ file: `${fname}.json.gz`, matchup, frames: res.frames, steps: res.steps, chat: res.chatEntries, hasUpgrades: res.hasUpgrades, gzKB: (gz.length / 1024).toFixed(1) });
      console.log(`  + ${fname}.json.gz  ${matchup}  (${res.frames}f, ${res.chatEntries} chat${res.hasUpgrades ? ', upgrades' : ''})`);
    }
    fs.writeFileSync(`${dir}/README.md`, buildPackReadme(manifest));
    console.log(`\nWrote ${manifest.length} converted replays + README → ${dir}`);
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
