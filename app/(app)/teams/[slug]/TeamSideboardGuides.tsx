'use client';

// B231: Team Sideboard Guides — a MATCHUP is the top-level unit. Within it each
// member has ONE take (their good-IN / bad-OUT + notes); the matchup view leads
// with the team CONSENSUS (cards ranked by how many takes agree), then the
// individual takes, then discussion. Three screens: matchups list, matchup view,
// and the my-take author form. Speaks the drills' IN=green / OUT=salmon language.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LeaderSelect, type LeaderSelectOption } from '@/app/_components/LeaderSelect';
import { CardSearch, type SelectedCard } from '@/app/_components/CardSearch';
import { AspectIcon } from '@/app/_components/AspectIcon';
import { EmptyState, ErrorNote, Loading } from '@/app/_components/StatusUi';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { QuizCard, GradientBorderButton, type QuizCardRef, type PickVerdict } from './OpeningPromptKit';
import { cardImageUrl } from '@/lib/cardImage';
import { relativeTime } from '@/lib/datetime';

const CYAN = '#66E5FF';
const GREEN = '#6bd968';
const SALMON = '#FF8E7A';
const panel: React.CSSProperties = { background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: tokens.radius.md, padding: 16 };

interface Matchup { ownLeader: string; ownBase: string; oppLeader: string; oppBase: string }
interface LeaderOpt { name: string; set: string | null; number: number | null }
interface BaseKind { key: string; label: string; kind: string; aspect: string | null; art: { set: string; number: number } | null; iconAspect: string | null }
interface Options { ownLeaders: LeaderOpt[]; oppLeaders: LeaderOpt[]; ownBaseKinds: BaseKind[]; oppBaseKinds: BaseKind[] }
type Art = Record<string, { set: string | null; number: number | null }>;
type BaseKinds = Record<string, BaseKind>;
interface GuideCard { cardId: string; note?: string | null }
interface PoolCard { cardId: string; name: string | null; set: string | null; number: number | null; cost: number | null; type: string | null; count: number; fraction: number }
interface MatchupSummary extends Matchup { takeCount: number; contributors: (string | null)[]; myTake: boolean }
interface Take { id: string; authorId: string; authorName: string | null; notes: string; cardsIn: GuideCard[]; cardsOut: GuideCard[]; updatedAt: string }
interface ConsensusCard { cardId: string; count: number }

type Screen = { s: 'list' } | { s: 'matchup'; m: Matchup } | { s: 'form'; m?: Matchup };

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
  const [screen, setScreen] = useState<Screen>({ s: 'list' });
  if (screen.s === 'form') return <TakeForm teamSlug={teamSlug} matchup={screen.m} onDone={() => setScreen(screen.m ? { s: 'matchup', m: screen.m } : { s: 'list' })} onSaved={(m) => setScreen({ s: 'matchup', m })} />;
  if (screen.s === 'matchup') return <MatchupView teamSlug={teamSlug} matchup={screen.m} onBack={() => setScreen({ s: 'list' })} onEditTake={(m) => setScreen({ s: 'form', m })} />;
  return <MatchupsList teamSlug={teamSlug} onNew={() => setScreen({ s: 'form' })} onOpen={(m) => setScreen({ s: 'matchup', m })} />;
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
  const kind = resolveBaseKind(baseKey, baseKinds);
  const named = kind?.kind === 'unique' || kind?.kind === 'unknown';
  const baseUrl = kind?.art ? cardImageUrl({ set: kind.art.set, number: kind.art.number }, false) : null;
  const h = Math.round(w * 0.72);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexDirection: reverse ? 'row-reverse' : 'row', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: reverse ? 'row-reverse' : 'row' }}>
        <div style={{ width: w, height: h, borderRadius: 4, background: leaderUrl ? `center/cover no-repeat url(${leaderUrl})` : '#1a1f28', flexShrink: 0 }} />
        {kind?.iconAspect ? <AspectIcon aspect={kind.iconAspect} size={big ? 30 : 24} />
          : baseUrl && <div style={{ width: Math.round(w * 0.92), height: h, borderRadius: 4, background: `center/cover no-repeat url(${baseUrl})`, flexShrink: 0 }} />}
      </div>
      <div style={{ minWidth: 0, textAlign: reverse ? 'right' : 'left' }}>
        <div style={{ fontSize: big ? 14 : 12.5, fontWeight: 700, color: '#e6ebf2', whiteSpace: 'nowrap' }}>{leader}</div>
        {named && <div style={{ fontSize: big ? 12 : 11, color: '#8a93a3', whiteSpace: 'nowrap' }}>{kind!.label}</div>}
      </div>
    </div>
  );
}

// ── Matchups list ───────────────────────────────────────────────────────────
function MatchupsList({ teamSlug, onNew, onOpen }: { teamSlug: string; onNew: () => void; onOpen: (m: Matchup) => void }) {
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
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading label="matchups" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e6ebf2' }}>Sideboard guides</div>
          <div style={{ fontSize: 13, color: '#8a93a3', marginTop: 3 }}>Pick a matchup — the team&apos;s takes on what to bring in, cut, and why.</div>
        </div>
        <GradientBorderButton testId="guide-new" onClick={onNew}>Add a take</GradientBorderButton>
      </div>
      {data.matchups.length === 0 ? (
        <EmptyState icon="🗒️">No matchups yet — add a take for one your team plays.</EmptyState>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
          {data.matchups.map((m) => (
            <button key={mq(m)} type="button" data-testid="matchup-row" onClick={() => onOpen(m)}
              style={{ ...panel, padding: 12, cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <MatchupRow m={m} leaderArt={data.leaderArt} baseKinds={data.baseKinds} />
              <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#8a93a3', alignItems: 'center' }}>
                <span style={{ color: '#c8cdd8', fontWeight: 700 }}>{m.takeCount} take{m.takeCount === 1 ? '' : 's'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.contributors.filter(Boolean).join(', ')}</span>
                {m.myTake && <span style={{ marginLeft: 'auto', color: CYAN, fontWeight: 700 }}>your take ✓</span>}
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
    if (!confirm('Remove your take on this matchup?')) return;
    const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup?${mq(matchup)}`, { method: 'DELETE' })).json();
    if (j.ok) void load();
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!d) return <Loading label="the matchup" />;
  const takes: Take[] = d.takes ?? [];
  const cons = d.consensus ?? { inCards: [], outCards: [], total: 0 };
  const leaderArt: Art = d.leaderArt ?? {}; const baseKinds: BaseKinds = d.baseKinds ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={backBtn}>← Matchups</button>
        <span style={{ flex: 1 }} />
        <GradientBorderButton testId="edit-my-take" onClick={() => onEditTake(matchup)} style={{ padding: '0.5rem 1.1rem' }}>{d.myTake ? 'Edit my take' : 'Add my take'}</GradientBorderButton>
      </div>

      <div style={panel}><MatchupRow m={matchup} leaderArt={leaderArt} baseKinds={baseKinds} big /></div>

      {/* Consensus */}
      <div style={panel}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3', marginBottom: 12 }}>
          Team consensus · {cons.total} take{cons.total === 1 ? '' : 's'}
        </div>
        {cons.total === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6c7588' }}>No takes yet — add yours to start the consensus.</div>
        ) : (
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <ConsensusCol title="Bring in" tone={GREEN} verdict="match" cards={cons.inCards} total={cons.total} />
            <ConsensusCol title="Take out" tone={SALMON} verdict="theirs" cards={cons.outCards} total={cons.total} />
          </div>
        )}
      </div>

      {/* Individual takes */}
      {takes.map((t) => (
        <div key={t.id} style={panel} data-testid="matchup-take">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: t.authorId === d.viewerId ? CYAN : '#e6ebf2' }}>{t.authorId === d.viewerId ? 'Your take' : `${t.authorName ?? 'Teammate'}'s take`}</span>
            <span style={{ fontSize: 11, color: '#6c7588' }}>{relativeTime(t.updatedAt, { fallbackToDate: true })}</span>
            {t.authorId === d.viewerId && <button type="button" onClick={delMyTake} style={{ ...linkBtn, marginLeft: 'auto', color: '#6c7588' }}>remove</button>}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <TakeCol title="In" tone={GREEN} verdict="match" cards={t.cardsIn} />
            <TakeCol title="Out" tone={SALMON} verdict="theirs" cards={t.cardsOut} />
          </div>
          {t.notes?.trim() && <div style={{ fontSize: 13, color: '#c8cdd8', lineHeight: 1.55, whiteSpace: 'pre-wrap', marginTop: 10 }}>{t.notes}</div>}
        </div>
      ))}

      {/* Discussion */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Discussion{d.comments?.length ? ` · ${d.comments.length}` : ''}</div>
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

function ConsensusCol({ title, tone, verdict, cards, total }: { title: string; tone: string; verdict: PickVerdict; cards: ConsensusCard[]; total: number }) {
  return (
    <div style={{ flex: '1 1 340px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: tone, marginBottom: 10 }}>{title}</div>
      {cards.length === 0 ? <div style={{ fontSize: 12.5, color: '#6c7588' }}>—</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cards.map((c) => {
            const full = c.count === total;
            return (
              <div key={c.cardId} style={{ position: 'relative' }} title={`${c.count} of ${total} takes`}>
                <QuizCard card={ref(c)} width={58} noPreview mini verdict={verdict} />
                <span style={{ position: 'absolute', bottom: 2, right: 2, fontSize: 9, fontWeight: 800, color: '#0b0e13', background: full ? tone : '#c8cdd8', borderRadius: 4, padding: '0 4px' }}>{c.count}/{total}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
function TakeCol({ title, tone, verdict, cards }: { title: string; tone: string; verdict: PickVerdict; cards: GuideCard[] }) {
  return (
    <div style={{ flex: '1 1 300px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: tone, marginBottom: 8 }}>{title} · {cards.length}</div>
      {cards.length === 0 ? <div style={{ fontSize: 12, color: '#6c7588' }}>—</div> : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{cards.map((c, i) => <QuizCard key={`${c.cardId}-${i}`} card={ref(c)} width={52} noPreview mini verdict={verdict} />)}</div>
      )}
    </div>
  );
}

// One reserved swap row (Bring in / Take out) above the pool in the author form.
function ReservedSection({ title, tone, cards, render, empty }: { title: string; tone: string; cards: PoolCard[]; render: (c: PoolCard, w: number) => React.ReactNode; empty: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone, marginBottom: 8 }}>{title} · {cards.length}</div>
      {cards.length === 0 ? <div style={{ fontSize: 12, color: '#6c7588', fontStyle: 'italic' }}>{empty}</div>
        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{cards.map((c) => render(c, 76))}</div>}
    </div>
  );
}

// ── My-take author form ─────────────────────────────────────────────────────
function TakeForm({ teamSlug, matchup, onDone, onSaved }: { teamSlug: string; matchup?: Matchup; onDone: () => void; onSaved: (m: Matchup) => void }) {
  const locked = !!matchup; // adding/editing a take for an existing matchup
  const [options, setOptions] = useState<Options | null>(null);
  const [ownLeader, setOwnLeader] = useState(matchup?.ownLeader ?? '');
  const [ownBase, setOwnBase] = useState(matchup?.ownBase ?? '');
  const [oppLeader, setOppLeader] = useState(matchup?.oppLeader ?? '');
  const [oppBase, setOppBase] = useState(matchup?.oppBase ?? '');
  const [leaderArt, setLeaderArt] = useState<Art>({}); const [baseKinds, setBaseKinds] = useState<BaseKinds>({});
  const [notes, setNotes] = useState('');
  const [marks, setMarks] = useState<Record<string, 'in' | 'out'>>({});
  const [extra, setExtra] = useState<PoolCard[]>([]);
  const [pool, setPool] = useState<{ totalLists: number; cards: PoolCard[] } | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides`)).json();
      if (j.ok) { setOptions(j.data.options); setLeaderArt(j.data.leaderArt ?? {}); setBaseKinds(j.data.baseKinds ?? {}); }
      if (matchup) {
        const gj = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup?${mq(matchup)}`)).json();
        const my = gj.ok ? gj.data.myTake : null;
        if (my) {
          setNotes(my.notes ?? '');
          const m: Record<string, 'in' | 'out'> = {};
          for (const c of my.cardsIn) m[c.cardId] = 'in'; for (const c of my.cardsOut) m[c.cardId] = 'out';
          setMarks(m);
          setExtra([...my.cardsIn, ...my.cardsOut].map((c: GuideCard) => ({ cardId: c.cardId, name: null, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 })));
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

  const leaderOpts = (arr: LeaderOpt[] | undefined): LeaderSelectOption[] => (arr ?? []).map((o) => ({ value: o.name, label: o.name, art: { set: o.set ?? undefined, number: o.number ?? undefined }, artIsLeader: true }));
  const baseOpts = (kinds: BaseKind[] | undefined): LeaderSelectOption[] => (kinds ?? []).map((k) => ({ value: k.key, label: k.label, art: k.art ? { set: k.art.set, number: k.art.number } : undefined, artIsLeader: false, iconAspect: k.iconAspect ?? undefined }));

  const poolIds = useMemo(() => new Set((pool?.cards ?? []).map((c) => c.cardId)), [pool]);
  const allCards = useMemo(() => [...(pool?.cards ?? []), ...extra.filter((e) => !poolIds.has(e.cardId))], [pool, extra, poolIds]);
  const cycle = (id: string) => setMarks((m) => { const cur = m[id]; const next = { ...m }; if (cur === undefined) next[id] = 'in'; else if (cur === 'in') next[id] = 'out'; else delete next[id]; return next; });
  const addCard = (c: SelectedCard | null) => {
    if (!c) return;
    if (!allCards.some((x) => x.cardId === c.cardId)) setExtra((e) => [...e, { cardId: c.cardId, name: c.name, set: null, number: null, cost: null, type: null, count: 0, fraction: 0 }]);
    setMarks((m) => (m[c.cardId] ? m : { ...m, [c.cardId]: 'in' }));
  };

  const inCards = allCards.filter((c) => marks[c.cardId] === 'in');
  const outCards = allCards.filter((c) => marks[c.cardId] === 'out');
  const poolCards = allCards.filter((c) => !marks[c.cardId]);
  const poolVisible = showAll ? poolCards : poolCards.slice(0, 48);
  const renderCard = (c: PoolCard, w: number) => {
    const mk = marks[c.cardId];
    const verdict: PickVerdict | undefined = mk === 'in' ? 'match' : mk === 'out' ? 'theirs' : undefined;
    return (
      <button key={c.cardId} type="button" data-testid="guide-pool-card" onClick={() => cycle(c.cardId)} style={{ position: 'relative', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }}>
        <QuizCard card={ref(c)} width={w} noPreview mini verdict={verdict} />
        {c.count > 0 && <span style={{ position: 'absolute', top: 2, left: 2, fontSize: 9, fontWeight: 800, color: '#cfe4ff', background: 'rgba(0,0,0,0.72)', borderRadius: 4, padding: '0 4px' }}>{Math.round(c.fraction * 100)}%</span>}
      </button>
    );
  };

  const canSave = ownLeader && ownBase && oppLeader && oppBase && (inCards.length + outCards.length > 0 || notes.trim());
  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    const m: Matchup = { ownLeader, ownBase, oppLeader, oppBase };
    try {
      const j = await (await fetch(`/api/teams/${teamSlug}/sideboard-guides/matchup`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...m, notes, cardsIn: inCards.map((c) => ({ cardId: c.cardId })), cardsOut: outCards.map((c) => ({ cardId: c.cardId })) }) })).json();
      if (!j.ok) { setError(j.error || 'save failed'); return; }
      onSaved(m);
    } catch { setError('save failed'); } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onDone} style={backBtn}>← Back</button>
        <span style={{ fontSize: 15, fontWeight: 800, color: '#e6ebf2' }}>{locked ? 'Your take' : 'New take'}</span>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Matchup</div>
        {locked ? (
          <MatchupRow m={{ ownLeader, ownBase, oppLeader, oppBase }} leaderArt={leaderArt} baseKinds={baseKinds} big />
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px' }}>
              <LeaderSelect value={ownLeader} onChange={setOwnLeader} ariaLabel="Your leader" anyLabel="Your leader" options={leaderOpts(options?.ownLeaders)} testId="guide-own-leader" fullWidth />
              <LeaderSelect value={ownBase} onChange={setOwnBase} ariaLabel="Your base" anyLabel="Your base" options={baseOpts(options?.ownBaseKinds)} testId="guide-own-base" fullWidth />
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#6c7588' }}>VS</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: '1 1 300px' }}>
              <LeaderSelect value={oppLeader} onChange={setOppLeader} ariaLabel="Opponent leader" anyLabel="Opp leader" options={leaderOpts(options?.oppLeaders)} testId="guide-opp-leader" fullWidth />
              <LeaderSelect value={oppBase} onChange={setOppBase} ariaLabel="Opponent base" anyLabel="Opp base" options={baseOpts(options?.oppBaseKinds)} testId="guide-opp-base" fullWidth />
            </div>
          </div>
        )}
      </div>

      {/* Reserved IN / OUT */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ReservedSection title="Bring in" tone={GREEN} cards={inCards} render={renderCard} empty="Click cards in the pool below to bring them in." />
        <ReservedSection title="Take out" tone={SALMON} cards={outCards} render={renderCard} empty="Click a card again to move it here (cards you're cutting)." />
        <div style={{ maxWidth: 340 }}><CardSearch value={null} onChange={addCard} testId="guide-card-search" /></div>
      </div>

      {/* Pool */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Your card pool {pool ? `· ${pool.totalLists} lists` : ''}</div>
          <span style={{ fontSize: 11.5, color: '#8a93a3' }}>Click to bring <span style={{ color: GREEN, fontWeight: 700 }}>IN</span>; again to move <span style={{ color: SALMON, fontWeight: 700 }}>OUT</span>; again to return it.</span>
        </div>
        {!ownLeader ? <div style={{ fontSize: 12.5, color: '#6c7588' }}>Pick your leader to load the team&apos;s card pool for this archetype.</div>
          : poolLoading ? <Loading label="the card pool" />
            : <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{poolVisible.map((c) => renderCard(c, 72))}</div>
              {poolCards.length > poolVisible.length && <button type="button" onClick={() => setShowAll(true)} style={{ alignSelf: 'flex-start', ...linkBtn }}>Show all {poolCards.length} cards</button>}
            </>}
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a93a3' }}>Notes</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Your reasoning for this matchup — including play/draw nuance." data-testid="guide-notes" rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDone} style={backBtn}>Cancel</button>
        <GradientBorderButton testId="guide-save" onClick={save} disabled={!canSave || saving} style={{ padding: '0.55rem 1.4rem' }}>{saving ? 'Saving…' : 'Save my take'}</GradientBorderButton>
      </div>
    </div>
  );
}

const backBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #2e333c', borderRadius: 6, color: '#a0a8b8', fontFamily: 'inherit', fontSize: 12, padding: '6px 12px', cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'transparent', border: 0, color: '#5db4ff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', padding: '2px 0' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, color: '#e6e6e6', fontFamily: 'inherit', fontSize: 13, outline: 'none' };
