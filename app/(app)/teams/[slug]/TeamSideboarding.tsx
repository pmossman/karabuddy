'use client';

// B227: Team Sideboarding Drills — a thin adapter over the shared TeamDrills
// framework (identical setup/gauntlet/pool/history to Openings). Supplies only
// the sideboard Stage, labels, and per-item context.

import { TeamDrills, type DrillKind } from './TeamDrills';
import { SideboardStage } from './SideboardQuiz';

const SIDEBOARDING_KIND: DrillKind = {
  testPrefix: 'sideboard',
  poolPath: 'sideboarding',
  Stage: SideboardStage,
  copy: {
    loading: 'Loading decks…',
    emptyIcon: '🔄',
    emptyText: 'No sideboard decisions yet — they surface from team-shared Bo3 games.',
    setupTitle: 'Set up your session',
    beginLabel: 'Start drilling',
    unit: 'sideboard',
    unitPlural: 'sideboards',
    reviewingLabel: 'Reviewing sideboard',
    sessionCounter: (i, n) => `Sideboard ${i} of ${n}`,
    myTitle: 'My sideboards',
    answeredTitle: 'Answered',
    answeredHistoryTitle: 'Answered sideboards',
  },
  explainer: {
    headline: 'Practice your team’s between-games sideboarding',
    body: 'You get a real Bo3 matchup and who won the previous game. Decide what to cut from your deck and bring in from your sideboard, then see the recorder’s actual swap and the rest of the team. It’s not a test: a different swap is worth talking about.',
  },
  sessionMetric: (results) => {
    const different = Object.values(results).filter((v) => !v).length;
    return different > 0 ? `${different} different ${different === 1 ? 'swap' : 'swaps'}` : null;
  },
  summaryMark: (same) => <span style={{ color: same ? '#6c7588' : '#FFD60A', fontWeight: 700 }}>{same ? 'same swap' : 'different swap'}</span>,
  rowContext: (item) => (
    <span>· Game {item.gameNumber}{item.wonPrevious == null ? '' : item.wonPrevious ? ' · won last' : ' · lost last'}</span>
  ),
};

export function TeamSideboarding(props: { teamSlug: string; members: { userId: string; name: string | null }[]; viewerName: string }) {
  return <TeamDrills {...props} kind={SIDEBOARDING_KIND} />;
}
