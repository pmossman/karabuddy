import Link from 'next/link';
import { searchTeams, type TeamSort } from '@/lib/adminDirectory';
import { AdminSearch } from '../AdminSearch';
import { PRIMARY, MUTED, Card, Empty, fmtDate, pageWrap } from '../ui';

export const dynamic = 'force-dynamic';

const SORTS: [TeamSort, string][] = [['shares', 'Most shares'], ['members', 'Most members'], ['created', 'Newest'], ['name', 'Name']];

export default async function AdminTeamsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const sort = (SORTS.some(([s]) => s === sp.sort) ? sp.sort : 'shares') as TeamSort;
  const rows = await searchTeams(q, sort);

  const qsFor = (s: TeamSort) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('sort', s);
    return `/admin/teams?${p.toString()}`;
  };

  return (
    <main style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '10px 0 14px' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Teams</h1>
        <span style={{ fontSize: 12, color: MUTED }}>{rows.length}{rows.length >= 200 ? '+' : ''} {q ? 'matching' : 'total'}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <AdminSearch initial={q} sort={sort} placeholder="Search by team name…" />
        <div style={{ display: 'inline-flex', background: '#10141b', border: '1px solid #2e333c', borderRadius: 8, padding: 2 }}>
          {SORTS.map(([s, label]) => (
            <Link key={s} href={qsFor(s)} scroll={false} style={{
              fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 6, textDecoration: 'none',
              background: sort === s ? 'rgba(77,157,255,0.15)' : 'transparent', color: sort === s ? PRIMARY : '#8a93a3',
            }}>{label}</Link>
          ))}
        </div>
      </div>

      <Card>
        {rows.length === 0 ? <Empty label={q ? 'No teams match.' : 'No teams yet.'} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Team</th>
                <th style={th}>Members</th>
                <th style={th}>Shares</th>
                <th style={th}>Reviews</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.slug} style={{ borderTop: '1px solid #1a1f27' }}>
                  <td style={{ padding: '7px 8px' }}>
                    <Link href={`/admin/teams/${t.slug}`} style={{ color: '#e6ebf2', fontWeight: 600, textDecoration: 'none' }}>{t.name}</Link>
                    {t.private && <span style={{ color: MUTED, fontSize: 11 }}> · private</span>}
                    <div style={{ color: '#4a515e', fontSize: 11, fontFamily: 'monospace' }}>{t.slug}</div>
                  </td>
                  <td style={tdNum}>{t.members.toLocaleString()}</td>
                  <td style={{ ...tdNum, color: t.shares ? PRIMARY : MUTED, fontWeight: 700 }}>{t.shares.toLocaleString()}</td>
                  <td style={tdNum}>{t.reviews || '—'}</td>
                  <td style={{ padding: '7px 8px', color: '#9aa3b2' }}>{fmtDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700, textAlign: 'right' };
const tdNum: React.CSSProperties = { padding: '7px 8px', textAlign: 'right', color: '#c8cdd8' };
