'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Select } from '@/app/_components/Select';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { MemberTeamLines, MoveTeams, SectionTick } from './ForgeAnnouncementBody';
import { MoveTeamPreview } from './MoveTeamPreview';
import { hubCopy } from './copy';
import type { ForgeTeamContext } from './rules';

const f = tokens.forge;

const note: CSSProperties = { margin: '10px 0 0', fontSize: 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };

export function HubMoveRow({
  teams,
  status,
  initialTeam,
  defaultOpen = false,
  facts,
}: {
  teams: ForgeTeamContext;
  status: string;
  initialTeam: string | null;
  defaultOpen?: boolean;
  facts: ReactNode;
}) {
  const owned = teams.ownedTeams;
  const [open, setOpen] = useState(initialTeam !== null || defaultOpen);
  const [slug, setSlug] = useState(initialTeam ?? (owned.length === 1 ? owned[0].slug : ''));
  const team = owned.find((t) => t.slug === slug) ?? null;
  const moving = open && team !== null;

  const urlTeam = useSearchParams().get('team');
  const [followed, setFollowed] = useState(urlTeam);
  if (urlTeam !== followed) {
    setFollowed(urlTeam);
    if (urlTeam === null) setOpen(false);
    else if (owned.some((t) => t.slug === urlTeam)) {
      setSlug(urlTeam);
      setOpen(true);
    }
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const want = moving ? slug : null;
    if (url.searchParams.get('team') === want) return;
    if (want) url.searchParams.set('team', want);
    else url.searchParams.delete('team');
    window.history.replaceState(null, '', url);
  }, [moving, slug]);

  return (
    <details className="kbf-hub-move" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <h2 id="hub-move" style={{ margin: 0, fontSize: 17, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.005em', display: 'flex', alignItems: 'center', gap: 10 }}>
          <SectionTick color={f.markBlue} size={6} />
          {hubCopy.move.heading}
        </h2>
        <span className="kbf-hub-move-status">{status}</span>
        <span className="kbf-hub-move-toggle">
          <span className="kbf-when-closed">{hubCopy.move.show}</span>
          <span className="kbf-when-open">{hubCopy.move.hide}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className={moving ? 'kbf-hub-move-grid kbf-hub-moving' : 'kbf-hub-move-grid'}>
        <div style={{ gridArea: 'pick' }}>
          {owned.length > 0 ? (
            <TeamPicker teams={teams} slug={slug} onPick={setSlug} />
          ) : (
            <MoveTeams teams={teams} detailed />
          )}
        </div>
        <div style={{ gridArea: 'facts' }}>{facts}</div>
        {moving && (
          <div className="kbf-hub-move-flow" style={{ gridArea: 'flow' }}>
            <MoveTeamPreview key={team.slug} slug={team.slug} initialTeamName={team.name} onCancel={() => setOpen(false)} />
          </div>
        )}
      </div>
    </details>
  );
}

function TeamPicker({ teams, slug, onPick }: { teams: ForgeTeamContext; slug: string; onPick: (slug: string) => void }) {
  const owned = teams.ownedTeams;
  const movedOn = owned.find((t) => t.slug === slug)?.movedOn;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: f.textMuted }}>{hubCopy.move.pickLabel}</div>
      {owned.length === 1 ? (
        <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{owned[0].name}</div>
      ) : (
        <Select<string>
          value={slug}
          onChange={onPick}
          options={owned.map((t) => [t.slug, t.name] as const)}
          placeholder={hubCopy.move.pickPlaceholder}
          ariaLabel={hubCopy.move.pickLabel}
          testId="hub-move-team"
          size="md"
          style={{ marginTop: 8, width: '100%', maxWidth: 360, background: f.bg, color: f.text, border: `1px solid ${f.border}`, fontFamily: f.font }}
        />
      )}
      {movedOn && <p style={note}>{hubCopy.move.movedNote(movedOn)}</p>}
      <MemberTeamLines teams={teams} detailed />
    </div>
  );
}
