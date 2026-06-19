'use client';

import { useCallback, useEffect, useState } from 'react';
import { Panel } from '@/app/_components/Panel';

// B170 / ADR 0010: the owner's private-team readiness roster. Turns a scary
// rollout into a visible checklist — per member: ready / needs-update / needs-key
// / not-seen, from the non-secret readiness each extension reports (capabilities
// + loaded key ids — never the key). Owner-only endpoint.

type Status = 'ready' | 'needs-update' | 'needs-key' | 'not-seen';
type Member = { userId: string; name: string; role: string; status: Status };

const STATUS: Record<Status, { icon: string; label: string; color: string }> = {
  ready: { icon: '✅', label: 'Ready', color: '#7ddf9b' },
  'needs-update': { icon: '⬆️', label: 'Needs extension update', color: '#ffb020' },
  'needs-key': { icon: '🔑', label: 'Needs the team key', color: '#ffb020' },
  'not-seen': { icon: '🕐', label: 'Not seen yet', color: '#8a93a3' },
};

export function ReadinessRoster({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/teams/${slug}/readiness`).then((res) => res.json());
      setMembers(r?.ok ? (r.members as Member[]) : []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const readyCount = members?.filter((m) => m.status === 'ready').length ?? 0;
  const total = members?.length ?? 0;

  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e6ebf2' }}>Team readiness</div>
        <button
          onClick={load}
          disabled={loading}
          style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: '#c2c9d6', fontFamily: 'inherit' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        Who can see this team’s encrypted replays. Members show <strong>Ready</strong> once they’ve updated the
        extension and loaded the key — nudge anyone who hasn’t. {total > 0 && <strong style={{ color: '#e6ebf2' }}>{readyCount}/{total} ready.</strong>}
      </p>
      {loading && members === null ? (
        <p style={{ margin: 0, fontSize: 13, color: '#8a93a3' }}>Loading…</p>
      ) : !members || members.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: '#8a93a3' }}>No members to show.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {members.map((m) => {
            const s = STATUS[m.status];
            return (
              <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #232a36' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#d6dbe4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name}{m.role === 'owner' && <span style={{ color: '#6c7588', fontSize: 11 }}> · owner</span>}
                </span>
                <span style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 600, color: s.color }}>{s.icon} {s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
