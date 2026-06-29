'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ErrorNote, Loading } from '@/app/_components/StatusUi';
import { Select } from '@/app/_components/Select';
import { formatTimestamp } from '@/lib/datetime';

// B124: the team page's Tournaments tab — list of this team's tournaments +
// a create form. Detail lives at /teams/[slug]/tournaments/[id].

interface TournamentListRow {
  id: string;
  name: string;
  status: 'setup' | 'active' | 'complete';
  decklistVisibility: string;
  plannedRounds: number | null;
  createdAt: string;
  entrantCount: number;
  roundCount: number;
}

const VISIBILITY_LABEL: Record<string, string> = {
  'open': 'Decklists open',
  'hidden-until-start': 'Decklists hidden until start',
  'private': 'Decklists private',
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  setup: { label: 'Registration', color: '#e0c64a', bg: 'rgba(224,198,74,0.12)' },
  active: { label: 'In progress', color: '#6bd968', bg: 'rgba(107,217,104,0.12)' },
  complete: { label: 'Finished', color: '#a0a8b8', bg: 'rgba(160,168,184,0.12)' },
};

export function TeamTournaments({ teamSlug }: { teamSlug: string }) {
  const [rows, setRows] = useState<TournamentListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('hidden-until-start');
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const res = await fetch(`/api/teams/${teamSlug}/tournaments`);
    const body = await res.json().catch(() => ({ ok: false, error: 'network error' }));
    if (!body.ok) { setError(body.error || 'failed to load'); return; }
    setRows(body.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [teamSlug]);

  const create = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/teams/${teamSlug}/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), decklistVisibility: visibility }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error || 'create failed'); return; }
      setName('');
      setCreating(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (rows === null) return <Loading />;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6c7588' }}>
          Async team tournaments — Swiss pairings, Bo3 matches, results from recorded replays.
        </span>
        <button type="button" onClick={() => setCreating((v) => !v)} style={primaryButtonStyle}>
          {creating ? 'Cancel' : '+ New tournament'}
        </button>
      </div>

      {creating && (
        <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={fieldLabelStyle}>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
              placeholder="e.g. June Worlds Prep Swiss"
              maxLength={120}
              style={inputStyle}
              autoFocus
            />
          </label>
          <label style={fieldLabelStyle}>
            Decklist visibility
            <Select
              size="sm"
              value={visibility}
              onChange={setVisibility}
              options={[
                ['hidden-until-start', 'Hidden until the tournament starts'],
                ['open', 'Open — team-visible immediately'],
                ['private', 'Private — entrant + organizer only'],
              ] as const}
              style={{ ...inputStyle, maxWidth: 'none' }}
            />
          </label>
          <div>
            <button type="button" onClick={create} disabled={!name.trim() || submitting} style={primaryButtonStyle}>
              {submitting ? 'Creating…' : 'Create tournament'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !creating ? (
        <div style={{ padding: 24, border: '1px dashed #2e333c', borderRadius: 8, textAlign: 'center', color: '#a0a8b8', fontSize: 13 }}>
          No tournaments yet. Create one and your teammates can register with their decklists.
        </div>
      ) : (
        rows.map((t) => {
          const status = STATUS_STYLE[t.status] ?? STATUS_STYLE.setup;
          return (
            <Link key={t.id} href={`/teams/${teamSlug}/tournaments/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#e6e6e6' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: '#6c7588', marginTop: 2 }}>
                    {t.entrantCount} {t.entrantCount === 1 ? 'entrant' : 'entrants'}
                    {t.roundCount > 0 ? ` · round ${t.roundCount}` : ''}
                    {' · '}{VISIBILITY_LABEL[t.decklistVisibility] ?? t.decklistVisibility}
                    {' · '}{formatTimestamp(t.createdAt, { time: false })}
                  </div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: status.color, background: status.bg, border: `1px solid ${status.color}40`, borderRadius: 999, padding: '3px 10px' }}>
                  {status.label}
                </span>
              </div>
            </Link>
          );
        })
      )}
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  background: tokens.surface.panel,
  border: `1px solid ${tokens.surface.panelBorder}`,
  borderRadius: tokens.radius.md,
  boxShadow: tokens.surface.panelShadow,
  padding: '12px 14px',
};
const inputStyle: React.CSSProperties = {
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  color: '#6c7588',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
};
const primaryButtonStyle: React.CSSProperties = {
  background: 'linear-gradient(180deg, #4d9dff, #3b7fe0)',
  border: '1px solid #6cb0ff',
  color: '#fff',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
