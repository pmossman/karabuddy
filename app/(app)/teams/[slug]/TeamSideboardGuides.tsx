'use client';

// B231: Team Sideboard Guides — matchup-scoped "cards good (IN) / bad (OUT) in
// this matchup" + notes, authored by a member and shared with the team. Three
// screens: the guides list, the author form (matchup selectors → a frequency-
// sorted card palette from the team's decklists → mark IN/OUT), and the view.
// Speaks the drills' IN=green / OUT=salmon visual language.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
import { CardSearch, type SelectedCard } from '@/app/_components/CardSearch';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { QuizCard, GradientBorderButton, type QuizCardRef, type PickVerdict } from './OpeningPromptKit';

const CYAN = '#66E5FF';
const panel: React.CSSProperties = { background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 16 };

interface LBOpt { name: string; set: string | null; number: number | null }
interface Matchups { ownLeaders: LBOpt[]; ownBases: LBOpt[]; oppLeaders: LBOpt[]; oppBases: LBOpt[] }
type Art = Record<string, { set: string | null; number: number | null }>;
interface GuideCard { cardId: string; note?: string | null }
interface GuideSummary {
  id: string; ownLeader: string; ownBase: string; oppLeader: string; oppBase: string;
  title: string | null; notes: string; cardsIn: GuideCard[]; cardsOut: GuideCard[];
  authorId: string; authorName: string | null; updatedAt: string;
}
interface PoolCard { cardId: string; name: string | null; set: string | null; number: number | null; cost: number | null; type: string | null; count: number; fraction: number }

type Screen = { s: 'list' } | { s: 'form'; id?: string } | { s: 'view'; id: string };

function ref(c: { cardId: string; name?: string | null; set?: string | null; number?: number | null; cost?: number | null }): QuizCardRef {
  let set = c.set ?? ''; let number = (c.number as number) ?? 0;
  // Guide cards store only the cardId (SET_NNN) — derive art from it.
  if (!set || !number) {
    const m = /^([A-Za-z]+)_0*(\d+)/.exec(c.cardId);
    if (m) { set = m[1]; number = Number(m[2]); }
  }
  return { id: c.cardId, name: c.name ?? null, cost: c.cost ?? null, set, number };
}
function leaderArt(name: string, art: Art, isLeader: boolean) {
  const a = art[name];
  return a ? { name, set: a.set ?? undefined, number: a.number ?? undefined } : { name };
}

export function TeamSideboardGuides({ teamSlug, viewerName }: { teamSlug: string; viewerName: string }) {
  const [screen, setScreen] = useState<Screen>({ s: 'list' });
  if (screen.s === 'form') return <GuideForm teamSlug={teamSlug} guideId={screen.id} onDone={() => setScreen({ s: 'list' })} onSaved={(id) => setScreen({ s: 'view', id })} />;
  if (screen.s === 'view') return <GuideView guideId={screen.id} onBack={() => setScreen({ s: 'list' })} onEdit={(id) => setScreen({ s: 'form', id })} />;
  return <GuidesList teamSlug={teamSlug} onNew={() => setScreen({ s: 'form' })} onOpen={(id) => setScreen({ s: 'view', id })} />;
}

// ── List ──────────────────────────────────────────────────────────────────
function GuidesList({ teamSlug, onNew, onOpen }: { teamSlug: string; onNew: () => void; onOpen: (id: string) => void }) {
  const [data, setData] = useState<{ guides: GuideSummary[]; art: Art } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides`)).json();
        if (!j.ok) { setError(j.error || 'failed'); return; }
        setData({ guides: j.data.guides, art: j.data.art });
      } catch { setError('failed to load'); }
    })();
  }, [teamSlug]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading label="guides" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e6ebf2' }}>Sideboard guides</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 3 }}>Team-shared plans for a matchup — what to bring in, what to cut, and why.</div>
        </div>
        <GradientBorderButton testId="guide-new" onClick={onNew}>New guide</GradientBorderButton>
      </div>
      {data.guides.length === 0 ? (
        <EmptyState icon="🗒️">No sideboard guides yet — create one for a matchup your team plays.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
          {data.guides.map((g) => (
            <button key={g.id} type="button" data-testid="guide-row" onClick={() => onOpen(g.id)}
              style={{ ...panel, padding: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MatchupRow g={g} art={data.art} />
              {g.title && <div style={{ fontSize: 13, fontWeight: 700, color: '#e6ebf2' }}>{g.title}</div>}
              <div style={{ display: 'flex', gap: 10, fontSize: 11.5, color: '#8a93a3' }}>
                <span style={{ color: '#6bd968', fontWeight: 700 }}>{g.cardsIn.length} in</span>
                <span style={{ color: '#FF8E7A', fontWeight: 700 }}>{g.cardsOut.length} out</span>
                <span style={{ marginLeft: 'auto' }}>{g.authorName ?? 'Teammate'}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchupRow({ g, art }: { g: { ownLeader: string; ownBase: string; oppLeader: string; oppBase: string }; art: Art }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <LeaderBasePair leader={leaderArt(g.ownLeader, art, true)} base={leaderArt(g.ownBase, art, false)} orientation="overlap" width={44} height={31} fit="cover" radius={4} fallback="hide" />
      <span style={{ fontSize: 10, fontWeight: 800, color: '#6c7588' }}>VS</span>
      <LeaderBasePair leader={leaderArt(g.oppLeader, art, true)} base={leaderArt(g.oppBase, art, false)} orientation="overlap" reverse width={44} height={31} fit="cover" radius={4} fallback="hide" />
      <span style={{ fontSize: 12, color: '#c8cdd8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.ownLeader} <span style={{ color: '#6c7588' }}>vs</span> {g.oppLeader}</span>
    </div>
  );
}

// ── Form (create / edit) ────────────────────────────────────────────────────
function GuideForm({ teamSlug, guideId, onDone, onSaved }: { teamSlug: string; guideId?: string; onDone: () => void; onSaved: (id: string) => void }) {
  const [matchups, setMatchups] = useState<Matchups | null>(null);
  const [ownLeader, setOwnLeader] = useState(''); const [ownBase, setOwnBase] = useState('');
  const [oppLeader, setOppLeader] = useState(''); const [oppBase, setOppBase] = useState('');
  const [title, setTitle] = useState(''); const [notes, setNotes] = useState('');
  const [marks, setMarks] = useState<Record<string, 'in' | 'out'>>({});
  const [extra, setExtra] = useState<PoolCard[]>([]); // off-pool cards added by search
  const [pool, setPool] = useState<{ totalLists: number; cards: PoolCard[] } | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // matchup options + (if editing) prefill
  useEffect(() => {
    (async () => {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides`)).json();
      if (j.ok) setMatchups(j.data.matchups);
      if (guideId) {
        const gj = await (await fetch(`/api/sideboard-guides/${guideId}`)).json();
        if (gj.ok) {
          const g = gj.data;
          setOwnLeader(g.ownLeader); setOwnBase(g.ownBase); setOppLeader(g.oppLeader); setOppBase(g.oppBase);
          setTitle(g.title ?? ''); setNotes(g.notes ?? '');
          const m: Record<string, 'in' | 'out'> = {};
          for (const c of g.cardsIn) m[c.cardId] = 'in';
          for (const c of g.cardsOut) m[c.cardId] = 'out';
          setMarks(m);
          // carry any marked cards as extras until the pool resolves them
          setExtra([...g.cardsIn, ...g.cardsOut].map((c: GuideCard) => ({ cardId: c.cardId, name: null, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 })));
        }
      }
    })();
  }, [teamSlug, guideId]);

  // The palette is your LEADER's full archetype pool (richest), keyed on leader
  // alone — a specific base pairing can be rare and would starve it. The base is
  // still part of the guide's matchup identity, just not a pool filter.
  const loadPool = useCallback(async (leader: string) => {
    if (!leader) { setPool(null); return; }
    setPoolLoading(true);
    try {
      const qs = new URLSearchParams({ ownLeader: leader });
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/pool?${qs}`)).json();
      setPool(j.ok ? j.data : { totalLists: 0, cards: [] });
    } catch { setPool({ totalLists: 0, cards: [] }); } finally { setPoolLoading(false); }
  }, [teamSlug]);
  useEffect(() => { void loadPool(ownLeader); }, [ownLeader, loadPool]);

  const opt = (arr: LBOpt[] | undefined, isLeader: boolean): LeaderSelectOption[] =>
    (arr ?? []).map((o) => ({ value: o.name, label: o.name, art: { set: o.set ?? undefined, number: o.number ?? undefined }, artIsLeader: isLeader }));

  // Merge pool + extras, dropping extras that the pool already contains.
  const poolIds = useMemo(() => new Set((pool?.cards ?? []).map((c) => c.cardId)), [pool]);
  const allCards = useMemo(() => [...(pool?.cards ?? []), ...extra.filter((e) => !poolIds.has(e.cardId))], [pool, extra, poolIds]);
  const cycle = (id: string) => setMarks((m) => {
    const cur = m[id]; const next = { ...m };
    if (cur === undefined) next[id] = 'in'; else if (cur === 'in') next[id] = 'out'; else delete next[id];
    return next;
  });
  const addCard = (c: SelectedCard | null) => {
    if (!c) return;
    if (!allCards.some((x) => x.cardId === c.cardId)) setExtra((e) => [...e, { cardId: c.cardId, name: c.name, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 }]);
    setMarks((m) => (m[c.cardId] ? m : { ...m, [c.cardId]: 'in' }));
  };

  const inCount = Object.values(marks).filter((v) => v === 'in').length;
  const outCount = Object.values(marks).filter((v) => v === 'out').length;
  const canSave = ownLeader && ownBase && oppLeader && oppBase && (inCount + outCount > 0 || notes.trim());

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const body = {
      ownLeader, ownBase, oppLeader, oppBase, title: title.trim() || null, notes,
      cardsIn: Object.entries(marks).filter(([, v]) => v === 'in').map(([cardId]) => ({ cardId })),
      cardsOut: Object.entries(marks).filter(([, v]) => v === 'out').map(([cardId]) => ({ cardId })),
    };
    try {
      const res = guideId
        ? await fetch(`/api/sideboard-guides/${guideId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/teams/${teamSlug}/sideboard-guides`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!j.ok) { setError(j.error || 'save failed'); return; }
      onSaved(guideId ?? j.data.id);
    } catch { setError('save failed'); } finally { setSaving(false); }
  };

  const visible = showAll ? allCards : allCards.slice(0, 60);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onDone} style={backBtn}>← Back</button>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>{guideId ? 'Edit guide' : 'New sideboard guide'}</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Matchup */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Matchup</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px' }}>
            <LeaderSelect value={ownLeader} onChange={setOwnLeader} ariaLabel="Your leader" anyLabel="Your leader" options={opt(matchups?.ownLeaders, true)} testId="guide-own-leader" fullWidth />
            <LeaderSelect value={ownBase} onChange={setOwnBase} ariaLabel="Your base" anyLabel="Your base" options={opt(matchups?.ownBases, false)} testId="guide-own-base" fullWidth />
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#6c7588' }}>VS</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px' }}>
            <LeaderSelect value={oppLeader} onChange={setOppLeader} ariaLabel="Opponent leader" anyLabel="Opp leader" options={opt(matchups?.oppLeaders, true)} testId="guide-opp-leader" fullWidth />
            <LeaderSelect value={oppBase} onChange={setOppBase} ariaLabel="Opponent base" anyLabel="Opp base" options={opt(matchups?.oppBases, false)} testId="guide-opp-base" fullWidth />
          </div>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Guide title (optional) — e.g. 'vs aggro, on the play'" data-testid="guide-title"
          style={inputStyle} />
      </div>

      {/* Palette */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>
            Your card pool {pool ? `· ${pool.totalLists} lists` : ''}
          </div>
          <span style={{ fontSize: 11.5, color: '#8a93a3' }}>Click a card to cycle <span style={{ color: '#6bd968', fontWeight: 700 }}>IN</span> → <span style={{ color: '#FF8E7A', fontWeight: 700 }}>OUT</span> → off.</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: '#6bd968' }}>{inCount} in</span><span style={{ color: '#FF8E7A' }}>{outCount} out</span>
          </span>
        </div>
        {!ownLeader ? (
          <div style={{ fontSize: 12.5, color: '#6c7588' }}>Pick your leader to load the team&apos;s card pool for this archetype.</div>
        ) : poolLoading ? (
          <Loading label="the card pool" />
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {visible.map((c) => {
                const mk = marks[c.cardId];
                const verdict: PickVerdict | undefined = mk === 'in' ? 'match' : mk === 'out' ? 'theirs' : undefined;
                return (
                  <button key={c.cardId} type="button" data-testid="guide-pool-card" onClick={() => cycle(c.cardId)}
                    style={{ position: 'relative', background: 'transparent', border: 0, padding: 0, cursor: 'pointer', transform: mk ? 'translateY(-4px)' : 'none', transition: 'transform 90ms' }}>
                    <QuizCard card={ref(c)} width={56} noPreview mini verdict={verdict} />
                    {c.count > 0 && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 8.5, fontWeight: 800, color: '#cfe4ff', background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '0 3px' }}>{Math.round(c.fraction * 100)}%</span>}
                  </button>
                );
              })}
            </div>
            {allCards.length > visible.length && (
              <button type="button" onClick={() => setShowAll(true)} style={{ alignSelf: 'flex-start', ...linkBtn }}>Show all {allCards.length} cards</button>
            )}
            <div style={{ maxWidth: 320 }}>
              <CardSearch value={null} onChange={addCard} testId="guide-card-search" />
            </div>
          </>
        )}
      </div>

      {/* Notes */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="The plan for this matchup — what you're doing and why." data-testid="guide-notes"
          rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={backBtn}>Cancel</button>
        <GradientBorderButton testId="guide-save" onClick={save} disabled={!canSave || saving} style={{ padding: '0.55rem 1.4rem' }}>
          {saving ? 'Saving…' : guideId ? 'Save changes' : 'Create guide'}
        </GradientBorderButton>
      </div>
    </div>
  );
}

// ── View ────────────────────────────────────────────────────────────────────
function GuideView({ guideId, onBack, onEdit }: { guideId: string; onBack: () => void; onEdit: (id: string) => void }) {
  const [g, setG] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const j = await (await fetch(`/api/sideboard-guides/${guideId}`)).json();
      if (!j.ok) { setError(j.error || 'failed'); return; }
      setG(j.data);
    } catch { setError('failed to load'); }
  }, [guideId]);
  useEffect(() => { void load(); }, [load]);

  const del = async () => {
    if (!confirm('Delete this guide?')) return;
    const j = await (await fetch(`/api/sideboard-guides/${guideId}`, { method: 'DELETE' })).json();
    if (j.ok) onBack();
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!g) return <Loading label="guide" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={backBtn}>← Guides</button>
        <span style={{ flex: 1 }} />
        {g.canEdit && <><button type="button" data-testid="guide-edit" onClick={() => onEdit(guideId)} style={backBtn}>Edit</button>
          <button type="button" data-testid="guide-delete" onClick={del} style={{ ...backBtn, color: '#FF8E7A', borderColor: '#5a2f2f' }}>Delete</button></>}
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <MatchupRow g={g} art={g.art} />
        {g.title && <div style={{ fontSize: 17, fontWeight: 800, color: '#e6ebf2', marginTop: 2 }}>{g.title}</div>}
        <div style={{ fontSize: 11.5, color: '#6c7588' }}>by {g.authorName ?? 'Teammate'}</div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <GuideCol title="Bring in" tone="#6bd968" verdict="match" cards={g.cardsIn} />
        <GuideCol title="Take out" tone="#FF8E7A" verdict="theirs" cards={g.cardsOut} />
      </div>

      {g.notes?.trim() && (
        <div style={{ ...panel }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 8 }}>Notes</div>
          <div style={{ fontSize: 13.5, color: '#c8cdd8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{g.notes}</div>
        </div>
      )}
    </div>
  );
}

function GuideCol({ title, tone, verdict, cards }: { title: string; tone: string; verdict: PickVerdict; cards: GuideCard[] }) {
  return (
    <div style={{ ...panel, flex: '1 1 340px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: tone, marginBottom: 10 }}>{title} · {cards.length}</div>
      {cards.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#6c7588' }}>Nothing listed.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cards.map((c, i) => (
            <div key={`${c.cardId}-${i}`} title={c.note ?? undefined}>
              <QuizCard card={ref(c)} width={62} noPreview mini verdict={verdict} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const backBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '6px 12px', cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 0, color: '#5db4ff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', padding: '2px 0' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, outline: 'none' };
