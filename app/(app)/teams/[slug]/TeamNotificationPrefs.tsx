'use client';

import { useEffect, useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';

// B81: per-team Discord DM preferences (member-only). Two toggles, both default
// ON; the global switch on /settings overrides these. PATCHes
// /api/teams/[slug]/members/me/prefs.
export function TeamNotificationPrefs({ slug }: { slug: string }) {
  const [prefs, setPrefs] = useState<{ dmOnDirectMention: boolean; dmOnTeamMention: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/teams/${slug}/members/me/prefs`)
      .then((r) => r.json())
      .then((b) => { if (live && b.ok) setPrefs({ dmOnDirectMention: b.dmOnDirectMention, dmOnTeamMention: b.dmOnTeamMention }); })
      .catch(() => {});
    return () => { live = false; };
  }, [slug]);

  const set = async (patch: Partial<{ dmOnDirectMention: boolean; dmOnTeamMention: boolean }>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next); // optimistic
    const res = await fetch(`/api/teams/${slug}/members/me/prefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const b = await res.json().catch(() => ({}));
    if (!b.ok) setPrefs(prefs); // revert
  };

  if (!prefs) return null;

  const row = (label: string, key: 'dmOnDirectMention' | 'dmOnTeamMention') => (
    <LedToggle checked={prefs[key]} onChange={(next) => set({ [key]: next })} label={label} statusOn="On" />
  );

  return (
    <section style={{ marginTop: 24, padding: 16, background: 'rgba(17,20,26,0.5)', border: '1px solid #2e333c', borderRadius: 8 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Discord notifications for this team</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
        How you want to be pinged for activity in this team. Your global switch on <a href="/settings" style={{ color: '#5da9ff' }}>Settings</a> overrides these.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {row('DM me when I’m directly @-mentioned on a replay shared with this team', 'dmOnDirectMention')}
        {row('DM me when this team is @-mentioned on a replay', 'dmOnTeamMention')}
      </div>
    </section>
  );
}
