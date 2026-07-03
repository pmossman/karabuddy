// B108: action-mode "stops" for the replay viewer. Stepping by action lands on
// these frame indices (and the play-through animates the frames between them).
//
// Originally a "stop" was only where the active player changed — which captures
// every action-phase action (plays/attacks alternate the active player), but
// SKIPS the regroup phase, where both players draw + resource without the active
// player alternating. So one action-step blew through all those beats at once.
//
// Now a frame is also a stop when a player DREW (their HAND grew — the deck pile
// is face-down/masked so it reads as 0 cards, so a draw only shows up as the
// hand getting bigger), DISCARDED (discard pile grew), or RESOURCED (resource
// pile grew) since the prior frame. Derived from pile counts — robust (no
// log-text matching) and works for both players (the opponent's piles are
// masked but still counted). A plain play shrinks the hand, so it doesn't
// trip the hand-grew check (and it's already an active-player boundary anyway).
//
// Setup decisions (B217): the setup phase is two karabast "all-player prompts"
// (mulligan, then resource). karabast sets NO isActionPhaseActivePlayer during
// it, so the active-change rule never fires there; and a mulligan DECISION moves
// no pile counts (a "keep" changes nothing; a "mulligan" redraws 6→6). So
// neither rule above catches a mulligan or a resourcing decision — stepping by
// action used to blow straight through them. We detect those straight from the
// game log (authoritative server text), one stop per decision, so each is its
// own beat. Matched against the messages NEWLY added on a frame (vs. the prior
// frame) so a cumulative log doesn't re-trip on every later frame — same
// delta approach as the undo-collapse detector. Pure + unit-tested.

function pileLen(player: any, zone: string): number {
  const list = player?.cardPiles?.[zone];
  return Array.isArray(list) ? list.length : 0;
}

// Setup/decision log markers (exact karabast server text):
//   MulliganPrompt → "{p} will mulligan" / "{p} will keep their hand"
//   ResourcePrompt → "{p} has resourced N card(s) from hand" /
//                    "{p} has not resourced any cards"
// (The resource marker also fires on each regroup's resourcing — harmless: that
// frame is already a pile-growth stop, and adding the same index is a no-op.)
//
// Action DECLARATIONS (B221): after "{p} claims initiative and passes", the
// opponent takes every remaining action of the phase and karabast keeps
// isActionPhaseActivePlayer on them the whole time — the active-flip rule sees
// no boundary, so one step blew through play + attack + … to the regroup draw
// (Lostrian's r_n5zhum f=77). Each action declared in the log is its own beat:
// "{p} plays {card}" / "{p} attacks {target} with {unit}" / the claim itself.
// Deliberately NOT "uses" — ability lines are sub-steps of the action they
// resolve (shield attaches, reveals…), animated as part of that action's beat.
// In normal alternating play these frames are already active-flip stops; the
// Set makes the re-add a no-op.
const DECISION_RE =
  /\bwill mulligan\b|\bwill keep their hand\b|\bhas resourced\b|\bhas not resourced any cards\b|\bplays\b|\battacks\b|\bclaims initiative\b/i;

// Every string anywhere inside a log entry (string parts, {type:'player',name},
// nested alert text). Depth-capped — log entries are tiny.
function collectStrings(v: any, out: string[], depth = 0): void {
  if (depth > 6 || v == null) return;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth + 1);
  else if (typeof v === 'object') for (const k of Object.keys(v)) collectStrings(v[k], out, depth + 1);
}

function frameMessages(frame: any): any[] {
  const msgs = frame?.state?.newMessages;
  return Array.isArray(msgs) ? msgs : [];
}

// A frame is a log-derived stop when its NEWLY-added lines (present here, absent
// on the prior frame — keyed by stable serialization) include a setup decision
// or an action declaration.
function hasNewDecision(frame: any, prevFrame: any): boolean {
  const cur = frameMessages(frame);
  if (cur.length === 0) return false;
  const prevKeys = new Set(frameMessages(prevFrame).map((m) => JSON.stringify(m)));
  for (const m of cur) {
    if (prevKeys.has(JSON.stringify(m))) continue;
    const parts: string[] = [];
    collectStrings(m, parts);
    if (DECISION_RE.test(parts.join(' '))) return true;
  }
  return false;
}

export function computeActionStops(
  frames: ReadonlyArray<{ state: any }> | null | undefined,
  activeByFrame: ReadonlyArray<string | null> | null | undefined,
): number[] {
  if (!frames || frames.length === 0) return [];
  const stops = new Set<number>([0, frames.length - 1]);
  for (let i = 1; i < frames.length; i++) {
    // Setup mulligan/resource decisions — no active flip, no pile growth ("keep"),
    // so detect them from the game log (B217).
    if (hasNewDecision(frames[i], frames[i - 1])) { stops.add(i); continue; }
    if (activeByFrame && activeByFrame[i] !== activeByFrame[i - 1]) { stops.add(i); continue; }
    const cur = frames[i]?.state?.players;
    const prev = frames[i - 1]?.state?.players;
    if (!cur || !prev || typeof cur !== 'object' || typeof prev !== 'object') continue;
    for (const pid of Object.keys(cur)) {
      const p = cur[pid];
      const q = prev[pid];
      if (!q) continue;
      if (
        pileLen(p, 'resources') > pileLen(q, 'resources') || // resourced
        pileLen(p, 'discard') > pileLen(q, 'discard') ||      // discarded
        pileLen(p, 'hand') > pileLen(q, 'hand')               // drew (deck is masked)
      ) {
        stops.add(i);
        break;
      }
    }
  }
  return Array.from(stops).sort((a, b) => a - b);
}

// The next stop strictly after (dir > 0) / before (dir < 0) `from`. Clamps to
// the last/first stop at the ends. Because stepping always lands on a stop, a
// forward step then a back step are inverses.
export function nextActionStop(stops: number[], from: number, dir: 1 | -1): number {
  if (!stops || stops.length === 0) return from;
  if (dir > 0) {
    for (const s of stops) if (s > from) return s;
    return stops[stops.length - 1];
  }
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < from) return stops[i];
  return stops[0];
}
