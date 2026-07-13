import Link from 'next/link';
import { notFound } from 'next/navigation';
import { userDetail } from '@/lib/adminDetail';
import { PRIMARY, MUTED, Card, Stat, Empty, Chip, ago, fmtDate, pageWrap } from '../../ui';

export const dynamic = 'force-dynamic';

const ROLE_COLOR: Record<string, string> = { owner: '#e8c13a' };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await userDetail(id);
  if (!d) notFound();

  return (
    <main style={pageWrap}>
      <Link href="/admin/users" style={{ fontSize: 12.5, color: PRIMARY, textDecoration: 'none' }}>← All users</Link>

      {/* Identity header */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '12px 0 4px' }}>
        {d.image
          ? <img src={d.image} alt="" width={52} height={52} style={{ borderRadius: '50%', border: '1px solid #2a3038' }} />
          : <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#1a2029', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: MUTED }}>{(d.name ?? '?').slice(0, 1).toUpperCase()}</div>}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{d.name ?? '(no name)'}</h1>
          <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
            {d.email ?? 'no email'} · joined {fmtDate(d.createdAt)} · last active {ago(d.lastActive)}
          </div>
          <div style={{ fontSize: 11, color: '#4a515e', marginTop: 2, fontFamily: 'monospace' }}>{d.id}</div>
        </div>
      </div>

      {/* Headline stats */}
      <Card>
        <div style={{ display: 'flex', gap: 28, padding: '2px', flexWrap: 'wrap' }}>
          <Stat label="Games recorded" value={d.games} accent={d.games ? '#e6ebf2' : MUTED} />
          {d.featureCounts.map((f) => <Stat key={f.key} label={f.label} value={f.n} />)}
          {d.games === 0 && d.featureCounts.length === 0 && <Empty label="No recorded activity." />}
        </div>
      </Card>

      {/* Teams */}
      <Card title="Teams" sub={`${d.teams.length}`}>
        {d.teams.length === 0 ? <Empty label="Not on any team." /> : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.teams.map((t) => (
              <Chip key={t.slug} href={`/admin/teams/${t.slug}`} color={ROLE_COLOR[t.role] ?? '#cdd3dd'}>
                {t.name}<span style={{ color: MUTED, fontSize: 11 }}>{t.role}</span>
              </Chip>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginTop: 14 }}>
        {/* Recent replays */}
        <Card title="Recent replays" sub={`${d.recentReplays.length}`}>
          {d.recentReplays.length === 0 ? <Empty label="No replays." /> : (
            <div>
              {d.recentReplays.map((r, i) => (
                <div key={r.slug} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
                  <Link href={`/r/${r.slug}`} style={{ flex: 1, color: '#cdd3dd', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name ?? r.slug}</Link>
                  <span style={{ color: MUTED, fontSize: 11 }}>{ago(r.when)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent comments */}
        <Card title="Recent comments" sub={`${d.recentComments.length}`}>
          {d.recentComments.length === 0 ? <Empty label="No comments." /> : (
            <div>
              {d.recentComments.map((c, i) => (
                <div key={i} style={{ padding: '6px 0', fontSize: 12.5, borderTop: i ? '1px solid #191d25' : undefined }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <Link href={`/r/${c.replaySlug}`} style={{ color: PRIMARY, textDecoration: 'none', fontSize: 11.5 }}>{c.replaySlug}</Link>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: MUTED, fontSize: 11 }}>{ago(c.when)}</span>
                  </div>
                  <div style={{ color: '#c4cad4', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.text}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
