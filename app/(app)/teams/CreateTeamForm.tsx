'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ErrorNote } from '@/app/_components/StatusUi';

export function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'failed to create team');
        return;
      }
      // B170: refresh so the server-resolved team list (sidebar switcher) picks up
      // the new team immediately — the (app) layout doesn't re-render on soft-nav.
      router.push(`/teams/${body.slug}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TacticalHeading>Create a team</TacticalHeading>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Team name (e.g. Tournament Prep)"
          maxLength={80}
          disabled={busy}
          style={{
            flex: 1,
            background: '#11141a',
            color: '#e6e6e6',
            border: '1px solid #2e333c',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          style={{
            background: tokens.button.bg,
            color: tokens.color.accent,
            border: `1px solid ${tokens.color.primary}`,
            boxShadow: tokens.button.glow,
            borderRadius: tokens.radius.sm,
            padding: '0 18px',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !name.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !name.trim() ? 0.5 : 1,
            fontFamily: 'inherit',
          }}
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}
