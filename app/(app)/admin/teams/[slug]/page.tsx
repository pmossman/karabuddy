import Link from 'next/link';
import { notFound } from 'next/navigation';
import { teamDetail } from '@/lib/adminDetail';
import { PRIMARY, MUTED, GOLD, Card, Stat, Empty, ago, fmtDate, pageWrap } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function AdminTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await teamDetail(slug);
  if (!d) notFound();

  return (
    <main style={pageWrap}>
      <Link href="/admin/teams" style={{ fontSize: 12.5, color: PRIMARY, textDecoration: 'none' }}>← All teams</Link>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '12px 0 2px', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{d.name}</h1>
        {d.private && <span style={{ fontSize: 12, color: GOLD, border: `1px solid ${GOLD}55`, borderRadius: 999, padding: '1px 9px', fontWeight: 700 }}>private</span>}
        <Link href={`/teams/${d.slug}`} style={{ fontSize: 12.5, color: PRIMARY, textDecoration: 'none' }}>open team page ↗</Link>
      </div>
      <div style={{ fontSize: 12.5, color: MUTED }}>{d.slug} · created {fmtDate(d.createdAt)}</div>

      {/* Feature counts */}
      <Card>
        <div style={{ display: 'flex', gap: 28, padding: '2px', flexWrap: 'wrap' }}>
          <Stat label="Members" value={d.members.length} accent="#e6ebf2" />
          {d.featureCounts.map((f) => <Stat key={f.key} label={f.label} value={f.n} />)}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        {/* Members */}
        <Card title="Members" sub={`${d.members.length}`}>
          {d.members.length === 0 ? <Empty label="No members." /> : (
            <div>
              {d.members.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
                  <Link href={`/admin/users/${m.id}`} style={{ flex: 1, color: '#cdd3dd', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name ?? '(no name)'}</Link>
                  <span style={{ color: m.role === 'owner' ? GOLD : MUTED, fontSize: 11, fontWeight: 700 }}>{m.role}</span>
                  <span style={{ color: MUTED, fontSize: 11 }}>joined {fmtDate(m.joinedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent shares */}
        <Card title="Recently shared replays" sub={`${d.recentShares.length}`}>
          {d.recentShares.length === 0 ? <Empty label="No shared replays." /> : (
            <div>
              {d.recentShares.map((s, i) => (
                <div key={s.slug} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
                  <Link href={`/r/${s.slug}`} style={{ flex: 1, color: '#cdd3dd', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name ?? s.slug}</Link>
                  <span style={{ color: MUTED, fontSize: 11 }}>{ago(s.when)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
