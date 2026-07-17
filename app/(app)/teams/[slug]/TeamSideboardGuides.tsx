'use client';

// B231: Team Sideboard Guides — a MATCHUP is the top-level unit. Within it each
// member has ONE take (their good-IN / bad-OUT + notes); the matchup view leads
// with the team CONSENSUS (cards ranked by how many takes agree), then the
// individual takes, then discussion. Three screens: matchups list, matchup view,
// and the my-take author form. Speaks the drills' IN=green / OUT=salmon language.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeMatchupConsensus, applyGuideToList, guideQty as qtyOf, sumQty, MAX_QTY, type GuideCard as LibGuideCard, type SplitCard, type ConsensusMember, type AppliedSwap } from '@/lib/sideboardConsensus';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
import { CardSearch, type SelectedCard } from '@/app/_components/CardSearch';
import { AspectIcon } from '@/app/_components/AspectIcon';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { QuizCard, GradientBorderButton, type QuizCardRef, type PickVerdict } from './OpeningPromptKit';
import { CardPile, PileGrid } from '@/app/_components/CardPile';
import { cardImageUrl } from '@/lib/cardImage';
import { relativeTime } from '@/lib/datetime';

const CYAN = '#66E5FF';
const GREEN = '#6bd968';
const SALMON = '#FF8E7A';
const panel: React.CSSProperties = { background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 16 };

interface Matchup { ownLeader: string; ownBase: string; oppLeader: string; oppBase: string }
interface LeaderOpt { value: string; name: string; subtitle: string | null; set: string | null; number: number | null }
interface BaseKind { key: string; label: string; kind: string; aspect: string | null; art: { set: string; number: number } | null; iconAspect: string | null; overlay?: 'force' | 'splash' | null }
interface Archetype { leader: LeaderOpt; base: BaseKind; count: number }
interface Options { ownLeaders: LeaderOpt[]; oppLeaders: LeaderOpt[]; ownBaseKinds: BaseKind[]; oppBaseKinds: BaseKind[]; ownArchetypes: Archetype[]; oppArchetypes: Archetype[] }
const ARCH_SEP = '|||';
type Art = Record<string, { set: string | null; number: number | null; name?: string | null; subtitle?: string | null }>;
type BaseKinds = Record<string, BaseKind>;
type GuideCard = LibGuideCard;
interface PoolCard { cardId: string; name: string | null; set: string | null; number: number | null; cost: number | null; type: string | null; count: number; fraction: number }
interface DecklistCard { cardId: string; count: number; name: string | null; set: string | null; number: number | null; cost: number | null; type: string | null }
interface ArchetypeDecklist { replaySlug: string; playedAt: string | null; recorderName: string | null; isMine: boolean; gameCount: number; main: DecklistCard[]; sideboard: DecklistCard[] }
// A deduped baseline list is played across many games — label it by whose it is,
// how recent, and how many games ran it (NOT by a single opponent).
const decklistLabel = (d: ArchetypeDecklist) => `${d.isMine ? 'Your list' : `${d.recorderName ?? 'Teammate'}’s list`}${d.playedAt ? ` · ${relativeTime(d.playedAt)}` : ''}${d.gameCount > 1 ? ` · ${d.gameCount} games` : ''}`;
interface MatchupSummary extends Matchup { takeCount: number; contributors: (string | null)[]; myTake: boolean }
interface DeckEntry { cardId: string; count: number }
interface TakeBaseline { main: DeckEntry[]; sideboard: DeckEntry[] }
interface Take { id: string; authorId: string; authorName: string | null; notes: string; cardsIn: GuideCard[]; cardsOut: GuideCard[]; baseline?: TakeBaseline | null; updatedAt: string }

// A DECK (your leader + base) is the top-level lens — you review its matchups.
interface Deck { ownLeader: string; ownBase: string }
const deckOf = (m: Matchup): Deck => ({ ownLeader: m.ownLeader, ownBase: m.ownBase });
const sameDeck = (m: Matchup | MatchupSummary, d: Deck) => m.ownLeader === d.ownLeader && m.ownBase === d.ownBase;
type Screen =
  | { s: 'decks' }
  | { s: 'deck'; deck: Deck }
  | { s: 'matchup'; m: Matchup; deck: Deck }
  | { s: 'form'; m?: Matchup; deck?: Deck };

const mq = (m: Matchup) => new URLSearchParams(m as any).toString();
function ref(c: { cardId: string; name?: string | null; set?: string | null; number?: number | null; cost?: number | null }): QuizCardRef {
  let set = c.set ?? ''; let number = (c.number as number) ?? 0;
  if (!set || !number) { const mm = /^([A-Za-z]+)_0*(\d+)/.exec(c.cardId); if (mm) { set = mm[1]; number = Number(mm[2]); } }
  return { id: c.cardId, name: c.name ?? null, cost: c.cost ?? null, set, number };
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function resolveBaseKind(key: string | undefined, kinds: BaseKinds): BaseKind | null {
  if (!key) return null;
  if (kinds[key]) return kinds[key];
  const asp = /^(?:asp|ab):([a-z]+)/.exec(key);
  if (asp) return { key, label: `${cap(asp[1])} base`, kind: 'vanilla', aspect: asp[1], art: null, iconAspect: asp[1] };
  const nm = /^name:(.+)$/.exec(key);
  return { key, label: nm ? nm[1] : key, kind: 'unknown', aspect: null, art: null, iconAspect: null };
}

export function TeamSideboardGuides({ teamSlug }: { teamSlug: string; viewerName?: string }) {
  const [screen, setScreen] = useState<Screen>({ s: 'decks' });
  if (screen.s === 'form') {
    return <TakeForm teamSlug={teamSlug} matchup={screen.m} deck={screen.deck}
      onDone={() => setScreen(screen.m ? { s: 'matchup', m: screen.m, deck: deckOf(screen.m) } : screen.deck ? { s: 'deck', deck: screen.deck } : { s: 'decks' })}
      onSaved={(m) => setScreen({ s: 'matchup', m, deck: deckOf(m) })} />;
  }
  if (screen.s === 'matchup') {
    return <MatchupView teamSlug={teamSlug} matchup={screen.m} onBack={() => setScreen({ s: 'deck', deck: screen.deck })} onEditTake={(m) => setScreen({ s: 'form', m, deck: screen.deck })} />;
  }
  if (screen.s === 'deck') {
    return <DeckMatchups teamSlug={teamSlug} deck={screen.deck} onBack={() => setScreen({ s: 'decks' })} onOpen={(m) => setScreen({ s: 'matchup', m, deck: screen.deck })} onNew={() => setScreen({ s: 'form', deck: screen.deck })} />;
  }
  return <DecksList teamSlug={teamSlug} onOpen={(deck) => setScreen({ s: 'deck', deck })} onNew={() => setScreen({ s: 'form' })} />;
}

// ── Matchup display (leader art + base: aspect icon vanilla / art+name unique) ─
function MatchupRow({ m, leaderArt, baseKinds, big }: { m: Matchup; leaderArt: Art; baseKinds: BaseKinds; big?: boolean }) {
  const w = big ? 60 : 44;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: big ? 18 : 12, flexWrap: 'wrap' }}>
      <MatchupSide leader={m.ownLeader} baseKey={m.ownBase} leaderArt={leaderArt} baseKinds={baseKinds} w={w} big={big} />
      <span style={{ fontSize: 11, fontWeight: 800, color: '#6c7588' }}>VS</span>
      <MatchupSide leader={m.oppLeader} baseKey={m.oppBase} leaderArt={leaderArt} baseKinds={baseKinds} w={w} big={big} reverse />
    </div>
  );
}
function MatchupSide({ leader, baseKey, leaderArt, baseKinds, w, big, reverse }: { leader: string; baseKey: string; leaderArt: Art; baseKinds: BaseKinds; w: number; big?: boolean; reverse?: boolean }) {
  const la = leaderArt[leader];
  const leaderUrl = la?.set && la?.number != null ? cardImageUrl({ set: la.set, number: la.number }, true) : null;
  // Leader value is "name · subtitle"; prefer the resolved name/subtitle, else split.
  const leaderName = la?.name ?? leader.split(' · ')[0];
  const leaderSubtitle = la?.subtitle ?? (leader.includes(' · ') ? leader.split(' · ').slice(1).join(' · ') : null);
  const kind = resolveBaseKind(baseKey, baseKinds);
  const named = kind?.kind === 'unique' || kind?.kind === 'unknown';
  const baseUrl = kind?.art ? cardImageUrl({ set: kind.art.set, number: kind.art.number }, false) : null;
  const h = Math.round(w * 0.72);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexDirection: reverse ? 'row-reverse' : 'row', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: reverse ? 'row-reverse' : 'row' }}>
        <div style={{ width: w, height: h, borderRadius: 4, background: leaderUrl ? `center/cover no-repeat url(${leaderUrl})` : '#1a1f28', flexShrink: 0 }} />
        {kind?.iconAspect ? <AspectIcon aspect={kind.iconAspect} overlay={kind.overlay ?? null} size={big ? 30 : 24} />
          : baseUrl && <div style={{ width: Math.round(w * 0.92), height: h, borderRadius: 4, background: `center/cover no-repeat url(${baseUrl})`, flexShrink: 0 }} />}
      </div>
      <div style={{ minWidth: 0, textAlign: reverse ? 'right' : 'left' }}>
        <div style={{ fontSize: big ? 14 : 12.5, fontWeight: 700, color: '#e6ebf2', whiteSpace: 'nowrap' }}>{leaderName}</div>
        {leaderSubtitle && <div style={{ fontSize: big ? 11.5 : 10.5, color: '#8a93a3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{leaderSubtitle}</div>}
        {named && <div style={{ fontSize: big ? 12 : 11, color: '#8a93a3', whiteSpace: 'nowrap' }}>{kind!.label}</div>}
      </div>
    </div>
  );
}

// Shared fetch of the team's guides bundle (matchups + art/base maps).
function useGuidesData(teamSlug: string) {
  const [data, setData] = useState<{ matchups: MatchupSummary[]; leaderArt: Art; baseKinds: BaseKinds } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides`)).json();
        if (!j.ok) { setError(j.error || 'failed'); return; }
        setData({ matchups: j.data.matchups, leaderArt: j.data.leaderArt ?? {}, baseKinds: j.data.baseKinds ?? {} });
      } catch { setError('failed to load'); }
    })();
  }, [teamSlug]);
  return { data, error };
}

// ── Level 1: your DECKS (leader/base) — the top-level lens ────────────────────
function DecksList({ teamSlug, onOpen, onNew }: { teamSlug: string; onOpen: (d: Deck) => void; onNew: () => void }) {
  const { data, error } = useGuidesData(teamSlug);
  const [q, setQ] = useState('');
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading label="your decks" />;

  // Group matchups by your deck (own leader + base).
  const map = new Map<string, { deck: Deck; matchups: number; members: Set<string>; mine: boolean }>();
  for (const m of data.matchups) {
    const key = `${m.ownLeader}|${m.ownBase}`;
    let e = map.get(key);
    if (!e) { e = { deck: deckOf(m), matchups: 0, members: new Set(), mine: false }; map.set(key, e); }
    e.matchups++;
    m.contributors.filter(Boolean).forEach((c) => e!.members.add(c as string));
    if (m.myTake) e.mine = true;
  }
  const decks = [...map.values()].sort((a, b) => b.matchups - a.matchups);
  const query = q.trim().toLowerCase();
  const shown = query ? decks.filter((d) => d.deck.ownLeader.toLowerCase().includes(query)) : decks;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e6ebf2' }}>Sideboard guides</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 3 }}>Pick your deck to review its matchups — what to bring in, cut, and why.</div>
        </div>
        <GradientBorderButton testId="guide-new" onClick={onNew}>New guide</GradientBorderButton>
      </div>
      {decks.length >= 2 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your decks…" data-testid="guide-deck-search"
          style={{ maxWidth: 360, boxSizing: 'border-box', padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', background: '#0d1016', border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 9, color: '#e6ebf2', outline: 'none' }} />
      )}
      {decks.length === 0 ? (
        <EmptyState icon="🗒️">No guides yet — start one for a deck your team plays.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="🔍">No decks match &ldquo;{q}&rdquo;.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
          {shown.map((d) => (
            <button key={`${d.deck.ownLeader}|${d.deck.ownBase}`} type="button" data-testid="deck-card" onClick={() => onOpen(d.deck)}
              style={{ ...panel, padding: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <MatchupSide leader={d.deck.ownLeader} baseKey={d.deck.ownBase} leaderArt={data.leaderArt} baseKinds={data.baseKinds} w={54} big />
              <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#8a93a3', alignItems: 'center' }}>
                <span style={{ color: '#c8cdd8', fontWeight: 700 }}>{d.matchups} matchup{d.matchups === 1 ? '' : 's'}</span>
                <span>· {d.members.size} member{d.members.size === 1 ? '' : 's'}</span>
                {d.mine && <span style={{ marginLeft: 'auto', color: CYAN, fontWeight: 700 }}>you ✓</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Level 2: a deck's MATCHUPS (vs each opponent) ─────────────────────────────
function DeckMatchups({ teamSlug, deck, onBack, onOpen, onNew }: { teamSlug: string; deck: Deck; onBack: () => void; onOpen: (m: Matchup) => void; onNew: () => void }) {
  const { data, error } = useGuidesData(teamSlug);
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading label="matchups" />;
  const matchups = data.matchups.filter((m) => sameDeck(m, deck));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={onBack} style={backBtn}>← Decks</button>
      <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <MatchupSide leader={deck.ownLeader} baseKey={deck.ownBase} leaderArt={data.leaderArt} baseKinds={data.baseKinds} w={60} big />
        <span style={{ flex: 1 }} />
        <GradientBorderButton testId="deck-add-matchup" onClick={onNew} style={{ padding: '0.5rem 1.1rem' }}>Add matchup</GradientBorderButton>
      </div>
      <div style={{ ...sectionLabel, marginBottom: 0 }}>Matchups · {matchups.length}</div>
      {matchups.length === 0 ? (
        <EmptyState icon="⚔️">No matchups yet for this deck — add one you expect to face.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
          {matchups.map((m) => (
            <button key={mq(m)} type="button" data-testid="matchup-row" onClick={() => onOpen(m)}
              style={{ ...panel, padding: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#6c7588' }}>VS</span>
                <MatchupSide leader={m.oppLeader} baseKey={m.oppBase} leaderArt={data.leaderArt} baseKinds={data.baseKinds} w={48} />
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#8a93a3', alignItems: 'center' }}>
                <span style={{ color: '#c8cdd8', fontWeight: 700 }}>{m.takeCount} member{m.takeCount === 1 ? '' : 's'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.contributors.filter(Boolean).join(', ')}</span>
                {m.myTake && <span style={{ marginLeft: 'auto', color: CYAN, fontWeight: 700 }}>you ✓</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Matchup view: consensus → takes → discussion ────────────────────────────
function MatchupView({ teamSlug, matchup, onBack, onEditTake }: { teamSlug: string; matchup: Matchup; onBack: () => void; onEditTake: (m: Matchup) => void }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [selTake, setSelTake] = useState<string | null>(null); // which member's take is shown
  const picksRef = useRef<HTMLDivElement>(null); // "Team picks" section — scrolled to on member-name click
  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup?${mq(matchup)}`)).json();
      if (!j.ok) { setError(j.error || 'failed'); return; }
      setD(j.data);
    } catch { setError('failed to load'); }
  }, [teamSlug, matchup]);
  useEffect(() => { void load(); }, [load]);

  const postComment = async () => {
    const text = comment.trim(); if (!text || posting) return;
    setPosting(true);
    try {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...matchup, body: text }) })).json();
      if (j.ok) { setComment(''); void load(); }
    } finally { setPosting(false); }
  };
  const delComment = async (cid: string) => {
    const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup/comments/${cid}`, { method: 'DELETE' })).json();
    if (j.ok) void load();
  };
  const delMyTake = async () => {
    if (!confirm('Remove your picks for this matchup?')) return;
    const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup?${mq(matchup)}`, { method: 'DELETE' })).json();
    if (j.ok) void load();
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!d) return <Loading label="the matchup" />;
  const takes: Take[] = d.takes ?? [];
  const leaderArt: Art = d.leaderArt ?? {}; const baseKinds: BaseKinds = d.baseKinds ?? {};
  // Show one member's take at a time via a pill selector. Default to your own
  // take (else the first); the explicit selection wins once you pick a pill.
  const myTakeId = takes.find((t) => t.authorId === d.viewerId)?.id;
  const activeTakeId = selTake && takes.some((t) => t.id === selTake) ? selTake : (myTakeId ?? takes[0]?.id);
  const activeTake = takes.find((t) => t.id === activeTakeId) ?? null;
  const analysis = analyzeMatchupConsensus(takes); // { total, planIn, planOut, split }

  // Click a member's name (in the Split section) → select their picks + scroll
  // there. The Split members are keyed by AUTHOR id; the pills key on TAKE id.
  const selectMember = (authorId: string) => {
    const t = takes.find((x) => x.authorId === authorId);
    if (t) setSelTake(t.id);
    picksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={backBtn}>← Matchups</button>
        <span style={{ flex: 1 }} />
        {/* All of YOUR-picks actions live together here — edit + remove. */}
        {d.myTake && <button type="button" onClick={delMyTake} style={dangerGhostBtn}>Remove</button>}
        <GradientBorderButton testId="edit-my-take" onClick={() => onEditTake(matchup)} style={{ padding: '0.5rem 1.1rem' }}>{d.myTake ? 'Edit my picks' : 'Add my picks'}</GradientBorderButton>
      </div>

      <div style={panel}><MatchupRow m={matchup} leaderArt={leaderArt} baseKinds={baseKinds} big /></div>

      {/* Consensus (2+ contributors only): THE PLAN (unanimous) + SPLIT (differences). */}
      {takes.length >= 2 && (
        <div style={panel}>
          <div style={sectionLabel}>Team consensus · {analysis.total} members</div>
          <div>
            <SubHead>The plan <span style={{ color: '#6c7588', fontWeight: 700 }}>· everyone agrees</span></SubHead>
            {analysis.planIn.length === 0 && analysis.planOut.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#6c7588' }}>No unanimous picks yet{analysis.split.length ? ' — see the split below' : ''}.</div>
            ) : (
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {analysis.planIn.length > 0 && (
                  <PileGrid label="Bring in" color={GREEN} w={78}>
                    {analysis.planIn.map((c) => <CardPile key={c.cardId} id={c.cardId} count={c.qty} color={GREEN} w={78} title={`${c.qty}× ${c.cardId} — all ${analysis.total} agree`} />)}
                  </PileGrid>
                )}
                {analysis.planOut.length > 0 && (
                  <PileGrid label="Take out" color={SALMON} w={78}>
                    {analysis.planOut.map((c) => <CardPile key={c.cardId} id={c.cardId} count={c.qty} color={SALMON} w={78} title={`${c.qty}× ${c.cardId} — all ${analysis.total} agree`} />)}
                  </PileGrid>
                )}
              </div>
            )}
          </div>

          {/* SPLIT — where members differ; names click through to their picks */}
          {analysis.split.length > 0 && (
            <div style={{ marginTop: 18, borderTop: '1px solid #21262f', paddingTop: 14 }}>
              <SubHead>Split <span style={{ color: '#6c7588', fontWeight: 700 }}>· where members differ — click a name to see their picks</span></SubHead>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 10, alignItems: 'stretch' }}>
                {analysis.split.map((sc) => <SplitRow key={sc.cardId} card={sc} viewerId={d.viewerId} onSelect={selectMember} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2+ contributors → a pill-per-member comparison. Exactly 1 → the pill
          selector is pointless, so show the one plan + a nudge to add more picks. */}
      {takes.length >= 2 ? (
        <div ref={picksRef} style={panel}>
          <div style={sectionLabel}>Each member&apos;s picks <span style={{ fontWeight: 700, textTransform: 'none', letterSpacing: 0, color: '#6c7588' }}>· tap a name</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {takes.map((t) => {
              const mine = t.authorId === d.viewerId;
              const on = t.id === activeTakeId;
              // Clear filter-chip look: every pill has a visible fill + border so
              // it reads as tappable; the selected one lights up (cyan for you).
              return (
                <button
                  key={t.id}
                  type="button"
                  data-testid="take-pill"
                  aria-pressed={on}
                  onClick={() => setSelTake(t.id)}
                  style={{
                    border: `1.5px solid ${on ? (mine ? CYAN : '#8a93a3') : '#39424f'}`, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 12.5, fontWeight: 700, padding: '6px 14px', borderRadius: 999,
                    background: on ? (mine ? 'rgba(102,229,255,0.16)' : 'rgba(255,255,255,0.10)') : '#1b2230',
                    color: on ? (mine ? CYAN : '#f0f3f8') : '#aeb6c4',
                    display: 'inline-flex', alignItems: 'center', gap: 6, boxShadow: on ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.03)',
                  }}
                >
                  {mine ? 'You' : (t.authorName ?? 'Teammate')}
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: on ? (mine ? CYAN : '#c8cdd8') : '#7a8394' }}>+{sumQty(t.cardsIn)}/−{sumQty(t.cardsOut)}</span>
                </button>
              );
            })}
          </div>
          {activeTake && (
            <div data-testid="matchup-take">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: activeTake.authorId === d.viewerId ? CYAN : '#e6ebf2' }}>{activeTake.authorId === d.viewerId ? 'Your picks' : `${activeTake.authorName ?? 'Teammate'}'s picks`}</span>
                <span style={{ fontSize: 11, color: '#6c7588' }}>{relativeTime(activeTake.updatedAt, { fallbackToDate: true })}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <TakeCol title="Bring in" tone={GREEN} cards={activeTake.cardsIn} />
                <TakeCol title="Take out" tone={SALMON} cards={activeTake.cardsOut} />
              </div>
              {activeTake.notes?.trim() && <div style={{ fontSize: 13, color: '#c8cdd8', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginTop: 10 }}>{activeTake.notes}</div>}
              <ApplyGuide teamSlug={teamSlug} matchup={matchup} take={activeTake} />
              <BaselineDeck take={activeTake} />
            </div>
          )}
        </div>
      ) : takes.length === 1 ? (
        <SolePlan take={takes[0]} teamSlug={teamSlug} matchup={matchup} viewerId={d.viewerId} onAdd={() => onEditTake(matchup)} />
      ) : null}

      {/* Discussion */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ ...sectionLabel, marginBottom: 0 }}>Discussion{d.comments?.length ? ` · ${d.comments.length}` : ''}</div>
        {(d.comments ?? []).length === 0 && <div style={{ fontSize: 12.5, color: '#6c7588' }}>No comments yet.</div>}
        {(d.comments ?? []).map((c: any) => (
          <div key={c.id} data-testid="matchup-comment" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e6ebf2' }}>{c.authorName ?? 'Teammate'}</span>
              <span style={{ fontSize: 11, color: '#6c7588' }}>{relativeTime(c.createdAt, { fallbackToDate: true })}</span>
              {c.authorId === d.viewerId && <button type="button" onClick={() => delComment(c.id)} style={{ ...linkBtn, marginLeft: 'auto', color: '#6c7588' }}>delete</button>}
            </div>
            <div style={{ fontSize: 13, color: '#c8cdd8', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note or comment…" data-testid="matchup-comment-input" rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, flex: 1 }} />
          <GradientBorderButton testId="matchup-comment-post" onClick={postComment} disabled={!comment.trim() || posting} style={{ padding: '0.5rem 1rem' }}>{posting ? '…' : 'Post'}</GradientBorderButton>
        </div>
      </div>
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: '#c8cdd8', marginBottom: 10 }}>{children}</div>;
}

// One SPLIT card: the pile + the members behind it, grouped by direction. Names
// are buttons that jump to that member's picks. Contested = brought in by some,
// cut by others.
function SplitRow({ card, viewerId, onSelect }: { card: SplitCard; viewerId: string; onSelect: (id: string) => void }) {
  const lean = card.contested ? '#d9a441' : (card.inMembers.length >= card.outMembers.length ? GREEN : SALMON);
  return (
    <div data-testid="split-card" style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0, background: '#0f131a', border: '1px solid #1c222c', borderRadius: 10, padding: '10px 12px' }}>
      {/* flexShrink:0 — the card must keep its full w+RESERVE width, else the flex
          row squeezes the box and its absolutely-positioned stacked copies spill
          out over the text beside it. */}
      <div style={{ flexShrink: 0 }}><CardPile id={card.cardId} count={card.qty} color={lean} w={52} title={card.cardId} /></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {card.contested && <span title="members disagree on this card" style={{ fontSize: 11, fontWeight: 800, color: '#d9a441', textTransform: 'uppercase', letterSpacing: '0.04em' }}>⚔ Contested</span>}
        {card.inMembers.length > 0 && <ChipRow label="In" tone={GREEN} members={card.inMembers} viewerId={viewerId} onSelect={onSelect} />}
        {card.outMembers.length > 0 && <ChipRow label="Out" tone={SALMON} members={card.outMembers} viewerId={viewerId} onSelect={onSelect} />}
      </div>
    </div>
  );
}
function ChipRow({ label, tone, members, viewerId, onSelect }: { label: string; tone: string; members: ConsensusMember[]; viewerId: string; onSelect: (id: string) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: tone, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {members.map((m) => {
        const mine = m.id === viewerId;
        return (
          <button key={m.id} type="button" data-testid="split-member" onClick={() => onSelect(m.id)}
            title="See their picks"
            style={{
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              background: '#141922', border: `1px solid ${tone}55`, color: mine ? CYAN : '#dfe4ec',
            }}>
            {mine ? 'You' : m.name}
          </button>
        );
      })}
    </span>
  );
}
// The replay decklist a take was authored from — collapsed by default, shown with
// the plan overlaid (cuts tinted salmon in the main, brings-in green in the
// sideboard) so a guide reads in the context of the list it assumes. Guides aren't
// tied to a list — this is provenance, and the seed for applying a guide to any list.
function BaselineDeck({ take }: { take: Take }) {
  const [open, setOpen] = useState(false);
  const b = take.baseline;
  if (!b || (!b.main?.length && !b.sideboard?.length)) return null;
  const inIds = new Set(take.cardsIn.map((c) => c.cardId));
  const outIds = new Set(take.cardsOut.map((c) => c.cardId));
  const mainTotal = b.main.reduce((s, c) => s + c.count, 0);
  const sideTotal = b.sideboard.reduce((s, c) => s + c.count, 0);
  const tile = (c: DeckEntry, which: 'main' | 'side') => {
    const tone = which === 'main' ? (outIds.has(c.cardId) ? SALMON : NEUTRAL) : (inIds.has(c.cardId) ? GREEN : NEUTRAL);
    return <CardPile key={c.cardId} id={c.cardId} count={c.count} color={tone} w={40} />;
  };
  return (
    <div data-testid="take-baseline" style={{ marginTop: 12, borderTop: '1px solid #1c222c', paddingTop: 10 }}>
      <button type="button" data-testid="take-baseline-toggle" onClick={() => setOpen((o) => !o)} style={{ ...linkBtn, color: '#8a93a3', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span> The list this guide is based on · {mainTotal} + {sideTotal}
      </button>
      {open && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ flex: '2 1 300px', minWidth: 0 }}>
            <div style={{ ...sectionLabel, marginBottom: 8, color: '#c8cdd8' }}>Main deck · {mainTotal} <span style={{ color: SALMON, fontWeight: 700 }}>· cuts in salmon</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{b.main.map((c) => tile(c, 'main'))}</div>
          </div>
          <div style={{ flex: '1 1 180px', minWidth: 0 }}>
            <div style={{ ...sectionLabel, marginBottom: 8, color: '#c8cdd8' }}>Sideboard · {sideTotal} <span style={{ color: GREEN, fontWeight: 700 }}>· brings in green</span></div>
            {b.sideboard.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{b.sideboard.map((c) => tile(c, 'side'))}</div>
              : <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>—</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const mutedLabel: React.CSSProperties = { fontSize: 11, color: '#8a93a3', marginBottom: 4 };
// B232: apply a guide's plan to one of YOUR recorded lists for this archetype —
// cuts match your MAIN, brings match your SIDEBOARD, and what doesn't fit is
// called out. The target lists come from the same recent-replays endpoint the
// author picked from, so guides transfer even when the decks differ.
function ApplyGuide({ teamSlug, matchup, take }: { teamSlug: string; matchup: Matchup; take: Take }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<ArchetypeDecklist[] | null>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!open || lists) return;
    let dead = false;
    (async () => {
      try {
        const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/decklists?ownLeader=${encodeURIComponent(matchup.ownLeader)}&ownBase=${encodeURIComponent(matchup.ownBase)}`)).json();
        if (!dead) setLists(j.ok ? j.data.decklists : []);
      } catch { if (!dead) setLists([]); }
    })();
    return () => { dead = true; };
  }, [open, lists, teamSlug, matchup]);
  const target = lists?.[idx] ?? null;
  const result = useMemo(() => target ? applyGuideToList({ cardsIn: take.cardsIn, cardsOut: take.cardsOut }, { main: target.main, sideboard: target.sideboard }) : null, [target, take]);

  const swaps = (items: AppliedSwap[], tone: string) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{items.map((x) => <CardPile key={x.cardId} id={x.cardId} count={x.applied} color={tone} w={44} />)}</div>;
  const misses = (items: GuideCard[]) => <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, opacity: 0.55 }}>{items.map((x) => <CardPile key={x.cardId} id={x.cardId} count={qtyOf(x)} color={NEUTRAL} w={34} />)}</div>;

  return (
    <div data-testid="apply-guide" style={{ marginTop: 10, borderTop: '1px solid #1c222c', paddingTop: 10 }}>
      <button type="button" data-testid="apply-guide-toggle" onClick={() => setOpen((o) => !o)} style={{ ...linkBtn, color: CYAN, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span> Apply to my list
      </button>
      {open && (lists === null ? <div style={{ marginTop: 8 }}><Loading label="your lists" /></div>
        : lists.length === 0 ? <div style={{ marginTop: 8, fontSize: 12.5, color: '#6c7588' }}>No recorded list of this deck to apply to — record a game with it first.</div>
        : (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lists.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: '#8a93a3' }}>Your list</span>
                {lists.map((d, i) => <button key={d.replaySlug} type="button" data-testid="apply-target" onClick={() => setIdx(i)} style={chipBtn(i === idx)}>{decklistLabel(d)}</button>)}
              </div>
            )}
            {result && (
              <>
                <div style={{ fontSize: 12.5, color: '#c8cdd8' }}>Applied to {target?.isMine ? 'your list' : `${target?.recorderName ?? 'this'}’s list`}: <b style={{ color: SALMON }}>−{result.cutTotal}</b> / <b style={{ color: GREEN }}>+{result.bringTotal}</b>.</div>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ ...sectionLabel, marginBottom: 8, color: SALMON }}>Cut from your deck · {result.cutTotal}</div>
                    {result.cut.length ? swaps(result.cut, SALMON) : <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>Nothing to cut.</div>}
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <div style={{ ...sectionLabel, marginBottom: 8, color: GREEN }}>Bring in from your sideboard · {result.bringTotal}</div>
                    {result.bring.length ? swaps(result.bring, GREEN) : <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>Nothing to bring in.</div>}
                  </div>
                </div>
                {(result.notRunning.length + result.missing.length + result.alreadyIn.length > 0) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: '#0f131a', border: '1px solid #1c222c', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#d9a441' }}>Doesn’t fit your list</div>
                    {result.notRunning.length > 0 && <div><div style={mutedLabel}>Guide cuts these — you’re not running them:</div>{misses(result.notRunning)}</div>}
                    {result.missing.length > 0 && <div><div style={mutedLabel}>Guide brings these — not in your deck or sideboard:</div>{misses(result.missing)}</div>}
                    {result.alreadyIn.length > 0 && <div><div style={mutedLabel}>Already in your maindeck:</div>{misses(result.alreadyIn)}</div>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
    </div>
  );
}

// One contributor: no consensus / pill selector — just the single plan (cards +
// notes) and a nudge to add more. (Remove lives in the header, with Edit.)
function SolePlan({ take, teamSlug, matchup, viewerId, onAdd }: { take: Take; teamSlug: string; matchup: Matchup; viewerId: string; onAdd: () => void }) {
  const mine = take.authorId === viewerId;
  const empty = take.cardsIn.length === 0 && take.cardsOut.length === 0;
  return (
    <div style={panel}>
      <div style={sectionLabel}>
        {mine ? 'Your picks' : `${take.authorName ?? 'Teammate'}'s picks`} <span style={{ fontWeight: 700, textTransform: 'none', letterSpacing: 0, color: '#6c7588' }}>· the only plan so far</span>
      </div>
      {!empty && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
          <TakeCol title="Bring in" tone={GREEN} cards={take.cardsIn} />
          <TakeCol title="Take out" tone={SALMON} cards={take.cardsOut} />
        </div>
      )}
      {take.notes?.trim() && <div style={{ fontSize: 13, color: '#c8cdd8', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 14 }}>{take.notes}</div>}
      {!empty && <ApplyGuide teamSlug={teamSlug} matchup={matchup} take={take} />}
      <BaselineDeck take={take} />
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px dashed #33414d', background: 'rgba(102,229,255,0.05)', borderRadius: 10, padding: '12px 14px' }}>
        {mine ? (
          <span style={{ fontSize: 12.5, color: '#8a93a3' }}>You&apos;re the first to weigh in — your teammates&apos; picks will show here to compare.</span>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: '#c8cdd8', flex: 1, minWidth: 180 }}>Only {take.authorName ?? 'one teammate'} has a plan here — add yours to build a consensus.</span>
            <GradientBorderButton testId="sole-add-picks" onClick={onAdd}>Add my picks</GradientBorderButton>
          </>
        )}
      </div>
    </div>
  );
}
// Individual pick list: piles, copies = stack depth (no number needed).
function TakeCol({ title, tone, cards }: { title: string; tone: string; cards: GuideCard[] }) {
  return (
    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
      {cards.length === 0
        ? <div><div style={{ fontSize: 11, fontWeight: 800, color: tone, marginBottom: 8 }}>{title} · 0</div><div style={{ fontSize: 12, color: '#6c7588' }}>—</div></div>
        : (
          <PileGrid label={`${title} · ${sumQty(cards)}`} color={tone} w={58}>
            {cards.map((c, i) => <CardPile key={`${c.cardId}-${i}`} id={c.cardId} count={qtyOf(c)} color={tone} w={58} title={`${qtyOf(c)}× ${c.cardId}`} />)}
          </PileGrid>
        )}
    </div>
  );
}

const stepBtn: React.CSSProperties = { border: 0, background: 'transparent', color: '#fff', fontSize: 15, fontWeight: 800, lineHeight: 1, width: 20, height: 20, cursor: 'pointer', padding: 0 };
const NEUTRAL = '#3a424f'; // unchanged card in a decklist column (no plan mark)
// Small IN/OUT + move pills (explicit — no click-to-cycle). `tone` = green/salmon.
const pillBtn = (tone: string, active: boolean): React.CSSProperties => ({ border: `1px solid ${active ? tone : '#2e333c'}`, background: active ? `${tone}22` : 'transparent', color: active ? tone : '#8a93a3', fontSize: 10.5, fontWeight: 800, borderRadius: 5, padding: '2px 8px', cursor: 'pointer', lineHeight: 1.3, fontFamily: 'inherit' });
// Lens segmented toggle (decklist vs pool) + source chip.
const segBtn = (active: boolean): React.CSSProperties => ({ border: `1px solid ${active ? CYAN : '#2e333c'}`, background: active ? `${CYAN}1e` : 'transparent', color: active ? CYAN : '#a0a8b8', fontSize: 11.5, fontWeight: 700, borderRadius: 6, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit' });
const chipBtn = (active: boolean): React.CSSProperties => ({ border: `1px solid ${active ? CYAN : '#2e333c'}`, background: active ? `${CYAN}1e` : '#0f131a', color: active ? CYAN : '#a0a8b8', fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' });

// One reserved swap row (Bring in / Take out) above the pool in the author form.
// `count` is the total COPIES (qty-summed), not the number of distinct cards.
function ReservedSection({ title, tone, cards, count, render, empty }: { title: string; tone: string; cards: PoolCard[]; count: number; render: (c: PoolCard, w: number) => React.ReactNode; empty: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone, marginBottom: 8 }}>{title} · {count} card{count === 1 ? '' : 's'}</div>
      {cards.length === 0 ? <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>{empty}</div>
        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{cards.map((c) => render(c, 76))}</div>}
    </div>
  );
}

// ── My-take author form ─────────────────────────────────────────────────────
function TakeForm({ teamSlug, matchup, deck, onDone, onSaved }: { teamSlug: string; matchup?: Matchup; deck?: Deck; onDone: () => void; onSaved: (m: Matchup) => void }) {
  const locked = !!matchup;       // editing a take on an existing matchup — all 4 fixed
  const lockOwn = !matchup && !!deck; // new matchup FOR a deck — your side fixed, opp open
  const [options, setOptions] = useState<Options | null>(null);
  const [ownLeader, setOwnLeader] = useState(matchup?.ownLeader ?? deck?.ownLeader ?? '');
  const [ownBase, setOwnBase] = useState(matchup?.ownBase ?? deck?.ownBase ?? '');
  const [oppLeader, setOppLeader] = useState(matchup?.oppLeader ?? '');
  const [oppBase, setOppBase] = useState(matchup?.oppBase ?? '');
  const [leaderArt, setLeaderArt] = useState<Art>({}); const [baseKinds, setBaseKinds] = useState<BaseKinds>({});
  const [notes, setNotes] = useState('');
  const [marks, setMarks] = useState<Record<string, { side: 'in' | 'out'; qty: number }>>({});
  const [extra, setExtra] = useState<PoolCard[]>([]);
  const [pool, setPool] = useState<{ totalLists: number; cards: PoolCard[] } | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState(false); // pick leader + base separately (fallback)
  // B232: two lenses onto the SAME plan (marks) — swap cards on a real decklist,
  // or pick from the team card pool. Baseline lists come from recent replays.
  const [lens, setLens] = useState<'decklist' | 'pool'>('pool');
  const [decklists, setDecklists] = useState<ArchetypeDecklist[] | null>(null);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [sideAdds, setSideAdds] = useState<Record<string, number>>({}); // tech cards added to the sideboard reservoir
  const [loadedBaseline, setLoadedBaseline] = useState<TakeBaseline | null>(null); // baseline of the take being edited

  useEffect(() => {
    (async () => {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides`)).json();
      if (j.ok) { setOptions(j.data.options); setLeaderArt(j.data.leaderArt ?? {}); setBaseKinds(j.data.baseKinds ?? {}); }
      if (matchup) {
        const gj = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup?${mq(matchup)}`)).json();
        const my = gj.ok ? gj.data.myTake : null;
        if (my) {
          setNotes(my.notes ?? '');
          const m: Record<string, { side: 'in' | 'out'; qty: number }> = {};
          for (const c of my.cardsIn) m[c.cardId] = { side: 'in', qty: qtyOf(c) }; for (const c of my.cardsOut) m[c.cardId] = { side: 'out', qty: qtyOf(c) };
          setMarks(m);
          setExtra([...my.cardsIn, ...my.cardsOut].map((c: GuideCard) => ({ cardId: c.cardId, name: null, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 })));
          setLoadedBaseline(my.baseline ?? null); // keep the stored baseline through a pool-lens edit
        }
      }
    })();
  }, [teamSlug, matchup]);

  const loadPool = useCallback(async (leader: string) => {
    if (!leader) { setPool(null); return; }
    setPoolLoading(true);
    try {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/pool?ownLeader=${encodeURIComponent(leader)}`)).json();
      setPool(j.ok ? j.data : { totalLists: 0, cards: [] });
    } catch { setPool({ totalLists: 0, cards: [] }); } finally { setPoolLoading(false); }
  }, [teamSlug]);
  useEffect(() => { void loadPool(ownLeader); }, [ownLeader, loadPool]);

  // Load the archetype's recent decklists as swap baselines. Default a NEW take to
  // the decklist lens when we have one to work from; editing stays on the pool
  // lens (its stored picks may reference cards outside a single baseline).
  useEffect(() => {
    if (!ownLeader || !ownBase) { setDecklists(null); return; }
    let dead = false;
    (async () => {
      try {
        const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/decklists?ownLeader=${encodeURIComponent(ownLeader)}&ownBase=${encodeURIComponent(ownBase)}`)).json();
        if (dead) return;
        const dl: ArchetypeDecklist[] = j.ok ? j.data.decklists : [];
        setDecklists(dl); setSourceIdx(0); setSideAdds({});
        setLens(dl.length && !matchup ? 'decklist' : 'pool');
      } catch { if (!dead) setDecklists([]); }
    })();
    return () => { dead = true; };
  }, [teamSlug, ownLeader, ownBase, matchup]);

  const leaderOpts = (arr: LeaderOpt[] | undefined): LeaderSelectOption[] => (arr ?? []).map((o) => ({ value: o.value, label: o.name, sublabel: o.subtitle, art: { set: o.set ?? undefined, number: o.number ?? undefined }, artIsLeader: true }));
  const baseOpts = (kinds: BaseKind[] | undefined): LeaderSelectOption[] => (kinds ?? []).map((k) => ({ value: k.key, label: k.label, art: k.art ? { set: k.art.set, number: k.art.number } : undefined, artIsLeader: false, iconAspect: k.iconAspect ?? undefined, overlay: k.overlay ?? null }));
  // Archetype (leader+base) options — one pick sets both. Leader art thumb; label
  // names the leader (+ subtitle) and its base. Popularity order comes from the API.
  const archOpts = (arr: Archetype[] | undefined): LeaderSelectOption[] => (arr ?? []).map((a) => ({
    value: `${a.leader.value}${ARCH_SEP}${a.base.key}`,
    label: a.leader.name, sublabel: a.leader.subtitle, // base is conveyed by its glyph, not text
    art: { set: a.leader.set ?? undefined, number: a.leader.number ?? undefined }, artIsLeader: true,
    base: { iconAspect: a.base.iconAspect ?? undefined, overlay: a.base.overlay ?? null, art: a.base.art ? { set: a.base.art.set, number: a.base.art.number } : undefined },
  }));
  const archValue = (leader: string, base: string) => (leader && base ? `${leader}${ARCH_SEP}${base}` : '');
  const pickArch = (setLeader: (v: string) => void, setBase: (v: string) => void) => (v: string) => { const [l, b] = v.split(ARCH_SEP); setLeader(l); setBase(b ?? ''); };

  // The current baseline decklist (decklist lens). `allCards` carries meta for
  // every card either lens can show — the pool, the baseline list, and search-adds
  // — so the shared plan summary can always render a marked card.
  const src = decklists?.[sourceIdx] ?? null;
  const baselineCards: PoolCard[] = useMemo(() => (src ? [...src.main, ...src.sideboard].map((c) => ({ cardId: c.cardId, name: c.name, set: c.set, number: c.number, cost: c.cost, type: c.type, count: 0, fraction: 0 })) : []), [src]);
  const allCards = useMemo(() => {
    const seen = new Set<string>(); const out: PoolCard[] = [];
    for (const c of [...(pool?.cards ?? []), ...baselineCards, ...extra]) if (!seen.has(c.cardId)) { seen.add(c.cardId); out.push(c); }
    return out;
  }, [pool, baselineCards, extra]);
  const metaById = useMemo(() => { const m = new Map<string, PoolCard>(); for (const c of allCards) m.set(c.cardId, c); return m; }, [allCards]);

  // Baseline copy-counts (side merges any search-added tech). The plan (marks) is
  // relative to these: an OUT card's copies move main→side, an IN card side→main.
  const baseMain = useMemo(() => new Map((src?.main ?? []).map((c) => [c.cardId, c.count] as const)), [src]);
  const baseSide = useMemo(() => {
    const m = new Map((src?.sideboard ?? []).map((c) => [c.cardId, c.count] as const));
    for (const [id, n] of Object.entries(sideAdds)) m.set(id, (m.get(id) ?? 0) + n);
    return m;
  }, [src, sideAdds]);
  const zoneCounts = (id: string) => {
    const inQ = marks[id]?.side === 'in' ? marks[id].qty : 0;
    const outQ = marks[id]?.side === 'out' ? marks[id].qty : 0;
    return { main: Math.max(0, (baseMain.get(id) ?? 0) - outQ + inQ), side: Math.max(0, (baseSide.get(id) ?? 0) + outQ - inQ) };
  };
  const deckColumn = (which: 'main' | 'side') => [...new Set<string>([...baseMain.keys(), ...baseSide.keys(), ...Object.keys(marks)])]
    .map((id) => ({ id, ...zoneCounts(id) }))
    .filter((r) => (which === 'main' ? r.main : r.side) > 0)
    .sort((a, b) => (metaById.get(a.id)?.cost ?? 99) - (metaById.get(b.id)?.cost ?? 99) || (metaById.get(a.id)?.name ?? a.id).localeCompare(metaById.get(b.id)?.name ?? b.id));

  // Explicit set/flip/remove — no click-to-cycle.
  const setSide = (id: string, side: 'in' | 'out' | null) => setMarks((m) => { const next = { ...m }; if (!side) delete next[id]; else next[id] = { side, qty: m[id]?.qty ?? 1 }; return next; });
  const bumpQty = (id: string, delta: number) => setMarks((m) => { const cur = m[id]; if (!cur) return m; const q = cur.qty + delta; const next = { ...m }; if (q < 1) delete next[id]; else next[id] = { ...cur, qty: Math.min(MAX_QTY, q) }; return next; });
  // Decklist lens: move ONE copy between main/side. Undo the opposite mark first
  // (a cut then re-brought copy nets to nothing), else add a mark up to what's
  // available in the source zone.
  const move = (id: string, dir: 'toSide' | 'toMain') => setMarks((m) => {
    const cur = m[id]; const next = { ...m };
    if (dir === 'toSide') {
      if (cur?.side === 'in') { if (cur.qty <= 1) delete next[id]; else next[id] = { side: 'in', qty: cur.qty - 1 }; }
      else { const outQ = cur?.side === 'out' ? cur.qty : 0; if (outQ >= Math.min(MAX_QTY, baseMain.get(id) ?? 0)) return m; next[id] = { side: 'out', qty: outQ + 1 }; }
    } else {
      if (cur?.side === 'out') { if (cur.qty <= 1) delete next[id]; else next[id] = { side: 'out', qty: cur.qty - 1 }; }
      else { const inQ = cur?.side === 'in' ? cur.qty : 0; if (inQ >= Math.min(MAX_QTY, baseSide.get(id) ?? 0)) return m; next[id] = { side: 'in', qty: inQ + 1 }; }
    }
    return next;
  });
  const addCard = (c: SelectedCard | null) => { // pool lens: add a card and mark it IN
    if (!c) return;
    if (!allCards.some((x) => x.cardId === c.cardId)) setExtra((e) => [...e, { cardId: c.cardId, name: c.name, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 }]);
    setMarks((m) => (m[c.cardId] ? m : { ...m, [c.cardId]: { side: 'in', qty: 1 } }));
  };
  const addSide = (c: SelectedCard | null) => { // decklist lens: drop a tech card into the sideboard reservoir
    if (!c) return;
    if (!allCards.some((x) => x.cardId === c.cardId)) setExtra((e) => [...e, { cardId: c.cardId, name: c.name, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 }]);
    setSideAdds((s) => ({ ...s, [c.cardId]: Math.min(MAX_QTY, (s[c.cardId] ?? 0) + 1) }));
  };

  const inCards = allCards.filter((c) => marks[c.cardId]?.side === 'in');
  const outCards = allCards.filter((c) => marks[c.cardId]?.side === 'out');
  const poolCards = allCards.filter((c) => !marks[c.cardId]);
  const poolVisible = showAll ? poolCards : poolCards.slice(0, 48);
  const withQty = (c: PoolCard): GuideCard => ({ cardId: c.cardId, qty: marks[c.cardId]?.qty ?? 1 });
  const inQty = inCards.reduce((s, c) => s + (marks[c.cardId]?.qty ?? 1), 0);
  const outQty = outCards.reduce((s, c) => s + (marks[c.cardId]?.qty ?? 1), 0);
  const mainRows = src ? deckColumn('main') : [];
  const sideRows = src ? deckColumn('side') : [];
  const mainTotal = mainRows.reduce((s, r) => s + r.main, 0);
  const sideTotal = sideRows.reduce((s, r) => s + r.side, 0);

  // Pool card: the card + explicit In / Out buttons (click again to clear).
  const renderCard = (c: PoolCard, w: number) => {
    const mk = marks[c.cardId];
    const verdict: PickVerdict | undefined = mk?.side === 'in' ? 'match' : mk?.side === 'out' ? 'theirs' : undefined;
    return (
      <div key={c.cardId} data-testid="guide-pool-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <QuizCard card={ref(c)} width={w} noPreview mini verdict={verdict} />
        <div style={{ display: 'flex', gap: 3 }}>
          <button type="button" data-testid="pool-in" onClick={() => setSide(c.cardId, mk?.side === 'in' ? null : 'in')} style={pillBtn(GREEN, mk?.side === 'in')}>In</button>
          <button type="button" data-testid="pool-out" onClick={() => setSide(c.cardId, mk?.side === 'out' ? null : 'out')} style={pillBtn(SALMON, mk?.side === 'out')}>Out</button>
        </div>
      </div>
    );
  };
  // Decklist-lens column card: the pile + one explicit move button (Cut → / ← Bring in).
  const renderDeckCard = (which: 'main' | 'side', row: { id: string; main: number; side: number }) => {
    const id = row.id; const mk = marks[id];
    const count = which === 'main' ? row.main : row.side;
    const tone = which === 'main' ? (mk?.side === 'in' ? GREEN : NEUTRAL) : (mk?.side === 'out' ? SALMON : NEUTRAL);
    return (
      <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        <CardPile id={id} count={count} color={tone} w={58} name={metaById.get(id)?.name ?? undefined} />
        {which === 'main'
          ? <button type="button" data-testid="deck-to-side" onClick={() => move(id, 'toSide')} style={pillBtn(SALMON, false)}>Cut →</button>
          : <button type="button" data-testid="deck-to-main" onClick={() => move(id, 'toMain')} style={pillBtn(GREEN, false)}>← Bring in</button>}
      </div>
    );
  };
  // Reserved (In/Out) card: a PILE (copies = stack), a −N+ stepper, and explicit
  // buttons to FLIP it to the other side (bring-in ↔ take-out) or remove it — the
  // qty carries across a flip.
  const renderReservedCard = (c: PoolCard, w: number) => {
    const mk = marks[c.cardId];
    const isIn = mk?.side !== 'out';
    const tone = isIn ? GREEN : SALMON;
    const q = mk?.qty ?? 1;
    return (
      <div key={c.cardId} data-testid="guide-reserved-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <CardPile id={c.cardId} count={q} color={tone} w={w} name={c.name} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(3,6,11,0.9)', border: `1px solid ${tone}66`, borderRadius: 8 }}>
          <button type="button" aria-label="one fewer" onClick={() => bumpQty(c.cardId, -1)} style={stepBtn}>−</button>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#fff', minWidth: 26, textAlign: 'center' }}>{q}×</span>
          <button type="button" aria-label="one more" disabled={q >= MAX_QTY} onClick={() => bumpQty(c.cardId, 1)} style={{ ...stepBtn, opacity: q >= MAX_QTY ? 0.35 : 1 }}>+</button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" data-testid="reserved-flip" onClick={() => setSide(c.cardId, isIn ? 'out' : 'in')} style={pillBtn(isIn ? SALMON : GREEN, false)} title={`Move to ${isIn ? 'Take out' : 'Bring in'}`}>{isIn ? '→ Take out' : '→ Bring in'}</button>
          <button type="button" data-testid="reserved-remove" onClick={() => setSide(c.cardId, null)} style={pillBtn('#6c7588', false)} title="Remove from the plan">✕</button>
        </div>
      </div>
    );
  };

  // A matchup must be fully specified before picking cards — a sideboard plan is
  // meaningless without knowing which deck vs which opponent.
  const matchupComplete = !!(ownLeader && ownBase && oppLeader && oppBase);
  const canSave = matchupComplete && (inCards.length + outCards.length > 0 || notes.trim());
  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const m: Matchup = { ownLeader, ownBase, oppLeader, oppBase };
    try {
      // Store the list this was authored from (decklist lens) so the guide can be
      // read against its context + later applied to any list. A pool-lens edit
      // keeps whatever baseline the take already had (don't wipe it on a note tweak).
      const baseline = lens === 'decklist' && src
        ? { main: src.main.map((c) => ({ cardId: c.cardId, count: c.count })), sideboard: src.sideboard.map((c) => ({ cardId: c.cardId, count: c.count })) }
        : loadedBaseline;
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...m, notes, cardsIn: inCards.map(withQty), cardsOut: outCards.map(withQty), baseline }) })).json();
      if (!j.ok) { setError(j.error || 'save failed'); return; }
      onSaved(m);
    } catch { setError('save failed'); } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onDone} style={backBtn}>← Back</button>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>{locked ? 'Your picks' : 'New picks'}</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ ...sectionLabel, marginBottom: 0 }}>Matchup</div>
        {locked ? (
          <MatchupRow m={{ ownLeader, ownBase, oppLeader, oppBase }} leaderArt={leaderArt} baseKinds={baseKinds} big />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Your side: fixed when adding a matchup for a deck; else a single
                  ARCHETYPE picker (a played deck) or, in manual mode, leader + base. */}
              {lockOwn ? (
                <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                  <MatchupSide leader={ownLeader} baseKey={ownBase} leaderArt={leaderArt} baseKinds={baseKinds} w={54} big />
                </div>
              ) : manual ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
                  <LeaderSelect value={ownLeader} onChange={setOwnLeader} ariaLabel="Your leader" anyLabel="Your leader" options={leaderOpts(options?.ownLeaders)} testId="guide-own-leader" fullWidth />
                  <LeaderSelect value={ownBase} onChange={setOwnBase} ariaLabel="Your base" anyLabel="Your base" options={baseOpts(options?.ownBaseKinds)} testId="guide-own-base" fullWidth />
                </div>
              ) : (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <LeaderSelect value={archValue(ownLeader, ownBase)} onChange={pickArch(setOwnLeader, setOwnBase)} ariaLabel="Your deck" anyLabel="Your deck" options={archOpts(options?.ownArchetypes)} testId="guide-own-archetype" fullWidth />
                </div>
              )}
              <span style={{ fontSize: 11, fontWeight: 800, color: '#6c7588' }}>VS</span>
              {manual ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, flex: '1 1 300px', minWidth: 0 }}>
                  <LeaderSelect value={oppLeader} onChange={setOppLeader} ariaLabel="Opponent leader" anyLabel="Opp leader" options={leaderOpts(options?.oppLeaders)} testId="guide-opp-leader" fullWidth />
                  <LeaderSelect value={oppBase} onChange={setOppBase} ariaLabel="Opponent base" anyLabel="Opp base" options={baseOpts(options?.oppBaseKinds)} testId="guide-opp-base" fullWidth />
                </div>
              ) : (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <LeaderSelect value={archValue(oppLeader, oppBase)} onChange={pickArch(setOppLeader, setOppBase)} ariaLabel="Opponent deck" anyLabel="Opp deck" options={archOpts(options?.oppArchetypes)} testId="guide-opp-archetype" fullWidth />
                </div>
              )}
            </div>
            <button type="button" onClick={() => setManual((v) => !v)} style={{ ...linkBtn, alignSelf: 'flex-start' }}>
              {manual ? '↤ Pick from a played deck' : 'Pick leader & base separately →'}
            </button>
          </>
        )}
      </div>

      {!matchupComplete ? (
        <div style={{ ...panel, padding: '26px 18px', textAlign: 'center', color: '#8a93a3', fontSize: 13 }} data-testid="guide-pick-matchup-first">
          Pick <span style={{ color: '#c8cdd8', fontWeight: 700 }}>your deck</span> and the <span style={{ color: '#c8cdd8', fontWeight: 700 }}>opponent</span> above to start adding cards.
        </div>
      ) : (
        <>
          {/* The plan — shared by both lenses, always visible */}
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <ReservedSection title="Bring in" tone={GREEN} cards={inCards} count={inQty} render={renderReservedCard} empty="Bring cards in from the sideboard (or pool) below." />
            <ReservedSection title="Take out" tone={SALMON} cards={outCards} count={outQty} render={renderReservedCard} empty="Cut cards from your deck below." />
            {inQty > 0 && outQty > 0 && inQty !== outQty && (
              <div style={{ fontSize: 12, color: '#d9a441' }}>Heads up: {inQty} in vs {outQty} out — a sideboard swap usually brings in and takes out the same number of cards.</div>
            )}
          </div>

          {/* Editing lens: swap on a real decklist, or pick from the team card pool */}
          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...sectionLabel, marginBottom: 0 }}>Build your plan</div>
              {(decklists?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                  <button type="button" data-testid="lens-decklist" onClick={() => setLens('decklist')} style={segBtn(lens === 'decklist')}>From a decklist</button>
                  <button type="button" data-testid="lens-pool" onClick={() => setLens('pool')} style={segBtn(lens === 'pool')}>From the card pool</button>
                </div>
              )}
            </div>

            {lens === 'decklist' && src ? (
              <div data-testid="decklist-lens" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(decklists?.length ?? 0) > 1 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 11.5, color: '#8a93a3' }}>Starting from</span>
                    {decklists!.map((d, i) => (
                      <button key={d.replaySlug} type="button" data-testid="decklist-source" onClick={() => setSourceIdx(i)} style={chipBtn(i === sourceIdx)}>
                        {decklistLabel(d)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: '#8a93a3' }}>{decklistLabel(src)} — cut from the deck, bring in from the sideboard.</div>
                )}
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                  <div style={{ flex: '2 1 340px', minWidth: 0 }}>
                    <div style={{ ...sectionLabel, marginBottom: 8, color: '#c8cdd8' }}>Main deck · {mainTotal}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{mainRows.map((r) => renderDeckCard('main', r))}</div>
                  </div>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ ...sectionLabel, marginBottom: 8, color: '#c8cdd8' }}>Sideboard · {sideTotal}</div>
                    {sideRows.length === 0
                      ? <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>No sideboard recorded — add cards below.</div>
                      : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{sideRows.map((r) => renderDeckCard('side', r))}</div>}
                    <div style={{ marginTop: 10, maxWidth: 300 }}><CardSearch value={null} onChange={addSide} testId="guide-card-search" /></div>
                  </div>
                </div>
              </div>
            ) : (
              <div data-testid="pool-lens" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 11.5, color: '#8a93a3' }}>{pool && pool.totalLists > 0 ? `Your team’s cards for this archetype · ${pool.totalLists} lists — ` : ''}mark cards <span style={{ color: GREEN, fontWeight: 700 }}>In</span> or <span style={{ color: SALMON, fontWeight: 700 }}>Out</span>.</span>
                {poolLoading ? <Loading label="the card pool" />
                  : <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{poolVisible.map((c) => renderCard(c, 66))}</div>
                    {poolCards.length > poolVisible.length && <button type="button" onClick={() => setShowAll(true)} style={{ alignSelf: 'flex-start', ...linkBtn }}>Show all {poolCards.length} cards</button>}
                  </>}
                <div style={{ maxWidth: 320 }}><CardSearch value={null} onChange={addCard} testId="guide-card-search" /></div>
              </div>
            )}
          </div>

          <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ ...sectionLabel, marginBottom: 0 }}>Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your reasoning for this matchup — including play/draw nuance." data-testid="guide-notes" rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={backBtn}>Cancel</button>
        <GradientBorderButton testId="guide-save" onClick={save} disabled={!canSave || saving} style={{ padding: '0.55rem 1.4rem' }}>{saving ? 'Saving…' : 'Save my picks'}</GradientBorderButton>
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '6px 12px', cursor: 'pointer' };
// Subtle destructive action — sits beside the primary Edit button in the header.
const dangerGhostBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #3a2f34', borderRadius: 8, color: '#c08a92', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '0.5rem 0.9rem', cursor: 'pointer' };
// The one panel-section header style (uppercase eyebrow). Used for every section.
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 10 };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 0, color: '#5db4ff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', padding: '2px 0' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, outline: 'none' };
