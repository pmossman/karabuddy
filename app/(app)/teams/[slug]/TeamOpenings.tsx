'use client';

// B221: Team Opening Drills — now a thin adapter over the shared TeamDrills
// framework (setup filters, gauntlet, pool/history lists all live there). This
// file supplies ONLY what's specific to openings: the quiz Stage, the labels,
// and the consensus/outcome badges.

import { TeamDrills, Badge, type DrillItem, type DrillKind } from './TeamDrills';
import { OpeningStage } from './OpeningQuiz';

const OPENINGS_KIND: DrillKind = {
  testPrefix: 'opening',
  poolPath: 'openings',
  Stage: OpeningStage,
  copy: {
    loading: 'Shuffling up…',
    emptyIcon: '🃏',
    emptyText: 'No openings yet — they appear when teammates share replays with a full setup.',
    setupTitle: 'Set up your session',
    beginLabel: 'Begin session',
    unit: 'opening',
    unitPlural: 'openings',
    reviewingLabel: 'Reviewing opening',
    sessionCounter: (i, n) => `Opening ${i} of ${n}`,
    myTitle: 'My openings',
    answeredTitle: 'Answered',
    answeredHistoryTitle: 'Answered openings',
  },
  sessionMetric: (results) => {
    const different = Object.values(results).filter((v) => !v).length;
    return different > 0 ? `${different} different ${different === 1 ? 'take' : 'takes'}` : null;
  },
  summaryMark: (same) => <span style={{ color: same ? '#6c7588' : '#FFD60A', fontWeight: 700 }}>{same ? 'same' : 'different take'}</span>,
  rowContext: (item) =>
    item.wentFirst !== null && item.wentFirst !== undefined ? (
      <span style={{ color: item.wentFirst ? '#00BAFF' : '#FF3231' }}>· {item.wentFirst ? 'initiative' : 'opp initiative'}</span>
    ) : null,
  rowBadges: (item) => <ConsensusBadge item={item} />,
  answeredOutcome: (item) => <OutcomeGlyph item={item} />,
};

export function TeamOpenings(props: { teamSlug: string; members: { userId: string; name: string | null }[]; viewerName: string }) {
  return <TeamDrills {...props} kind={OPENINGS_KIND} />;
}

// The consensus/split badge — computable once the tallies are serialized
// (viewer answered, or their upload). recordedDecision is the ground truth.
function ConsensusBadge({ item }: { item: DrillItem }) {
  const k = item.keepCount ?? 0;
  const m = item.mulliganCount ?? 0;
  const total = k + m;
  if (item.recordedDecision === undefined || total === 0) return null;
  if (k > 0 && m > 0) return <Badge color="#ffb454">⚡ Split {Math.max(k, m)}–{Math.min(k, m)}</Badge>;
  const unanimous = k > 0 ? 'keep' : 'mulligan';
  if (unanimous !== item.recordedDecision) return <Badge color="#ff7b72">▲ Team disagrees ({total})</Badge>;
  if (item.resourcesUnanimous === false) return <Badge color="#ffb454">≈ Picks differ ({total})</Badge>;
  return <Badge color="#6bd968">✓ Consensus ({total})</Badge>;
}

// The compact take glyph: [mulligan call][pick][pick] — muted where your take
// matched what was played, amber where it differed. Not a score.
function OutcomeGlyph({ item }: { item: DrillItem }) {
  if (item.myDecision === undefined || item.recordedDecision === undefined) return null;
  const chip = (same: boolean, key: string) => (
    <span key={key} style={{ width: 10, height: 14, borderRadius: 2, display: 'inline-block', background: same ? '#3a4150' : '#FFD60A' }} />
  );
  const decisionMatched = item.myDecision === item.recordedDecision;
  const comparable = item.myPickMatches !== null && item.myPickMatches !== undefined;
  const picks = comparable ? item.myPickMatches! : 0;
  const title = `${decisionMatched ? 'Same call' : `You ${item.myDecision}, they ${item.recordedDecision === 'keep' ? 'kept' : 'mulliganed'}`} · ${comparable ? `${picks}/2 resources shared` : 'picks from different hands'}`;
  return (
    <span title={title} style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {chip(decisionMatched, 'd')}
      <span style={{ width: 3 }} />
      {chip(picks >= 1, 'p1')}
      {chip(picks >= 2, 'p2')}
    </span>
  );
}
