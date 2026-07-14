// B231: pure consensus math for Sideboard Guides. NO db / server imports, so the
// server (lib/sideboardGuides) AND the client (TeamSideboardGuides) share ONE
// implementation. Keep it dependency-free.

export interface GuideCard { cardId: string; qty?: number; note?: string | null }

// SWU allows at most 3 copies of a card; a swap of 1–3 copies. Absent/garbage → 1.
export const MAX_QTY = 3;
export function guideQty(c: { qty?: number | null } | null | undefined): number {
  const n = Math.round(Number(c?.qty));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_QTY, n) : 1;
}
export const sumQty = (cards: GuideCard[]): number => cards.reduce((s, c) => s + guideQty(c), 0);

// Most common value (ties → the larger, so a 2-vs-3 split shows the bigger swap).
export function modeQty(qtys: number[]): number {
  const freq = new Map<number, number>();
  for (const q of qtys) freq.set(q, (freq.get(q) || 0) + 1);
  let best = 1, bestN = 0;
  for (const [q, n] of freq) if (n > bestN || (n === bestN && q > best)) { best = q; bestN = n; }
  return best;
}

// ── Flat consensus (card + agreement count + typical qty) ───────────────────
export interface ConsensusCard { cardId: string; count: number; qty: number }
export function computeConsensus(takes: { cardsIn: GuideCard[]; cardsOut: GuideCard[] }[]): { inCards: ConsensusCard[]; outCards: ConsensusCard[]; total: number } {
  const total = takes.length;
  const tally = (key: 'cardsIn' | 'cardsOut') => {
    const m = new Map<string, { count: number; qtys: number[] }>();
    for (const t of takes) {
      const seen = new Set<string>();
      for (const c of (t[key] || [])) if (c?.cardId && !seen.has(c.cardId)) {
        seen.add(c.cardId);
        const e = m.get(c.cardId) || { count: 0, qtys: [] };
        e.count += 1; e.qtys.push(guideQty(c)); m.set(c.cardId, e);
      }
    }
    return [...m.entries()].map(([cardId, e]) => ({ cardId, count: e.count, qty: modeQty(e.qtys) })).sort((a, b) => b.count - a.count || a.cardId.localeCompare(b.cardId));
  };
  return { inCards: tally('cardsIn'), outCards: tally('cardsOut'), total };
}

// ── Member-attributed analysis for the matchup view ─────────────────────────
// A card is part of THE PLAN only if EVERY member who wrote picks points the same
// way (unanimous, single direction). Everything else is a SPLIT: shown with the
// member names behind it (green = bring in, salmon = take out), and flagged
// `contested` when members disagree on direction.
export interface ConsensusMember { id: string; name: string }
export interface PlanCard { cardId: string; qty: number }
export interface SplitCard { cardId: string; qty: number; inMembers: ConsensusMember[]; outMembers: ConsensusMember[]; contested: boolean }
export interface MatchupConsensus { total: number; planIn: PlanCard[]; planOut: PlanCard[]; split: SplitCard[] }
export interface AnalyzableTake { authorId: string; authorName: string | null; cardsIn: GuideCard[]; cardsOut: GuideCard[] }

export function analyzeMatchupConsensus(takes: AnalyzableTake[]): MatchupConsensus {
  const total = takes.length;
  const byCard = new Map<string, { in: { m: ConsensusMember; qty: number }[]; out: { m: ConsensusMember; qty: number }[] }>();
  const slot = (id: string) => { let e = byCard.get(id); if (!e) { e = { in: [], out: [] }; byCard.set(id, e); } return e; };
  for (const t of takes) {
    const m: ConsensusMember = { id: t.authorId, name: t.authorName ?? 'Teammate' };
    const seenIn = new Set<string>(); const seenOut = new Set<string>();
    for (const c of (t.cardsIn || [])) if (c?.cardId && !seenIn.has(c.cardId)) { seenIn.add(c.cardId); slot(c.cardId).in.push({ m, qty: guideQty(c) }); }
    for (const c of (t.cardsOut || [])) if (c?.cardId && !seenOut.has(c.cardId)) { seenOut.add(c.cardId); slot(c.cardId).out.push({ m, qty: guideQty(c) }); }
  }

  const planIn: PlanCard[] = []; const planOut: PlanCard[] = []; const split: SplitCard[] = [];
  for (const [cardId, e] of byCard) {
    const inN = e.in.length, outN = e.out.length;
    if (total > 0 && inN === total && outN === 0) planIn.push({ cardId, qty: modeQty(e.in.map((x) => x.qty)) });
    else if (total > 0 && outN === total && inN === 0) planOut.push({ cardId, qty: modeQty(e.out.map((x) => x.qty)) });
    else split.push({
      cardId, qty: modeQty([...e.in, ...e.out].map((x) => x.qty)),
      inMembers: e.in.map((x) => x.m), outMembers: e.out.map((x) => x.m), contested: inN > 0 && outN > 0,
    });
  }
  const byQtyThenId = (a: PlanCard, b: PlanCard) => b.qty - a.qty || a.cardId.localeCompare(b.cardId);
  planIn.sort(byQtyThenId); planOut.sort(byQtyThenId);
  // Split: contested first (the real debates), then by how many members weighed in.
  split.sort((a, b) =>
    (Number(b.contested) - Number(a.contested)) ||
    ((b.inMembers.length + b.outMembers.length) - (a.inMembers.length + a.outMembers.length)) ||
    a.cardId.localeCompare(b.cardId));
  return { total, planIn, planOut, split };
}
