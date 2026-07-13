import Link from 'next/link';
import { searchUsers, type UserSort } from '@/lib/adminDirectory';
import { AdminSearch } from '../AdminSearch';
import { PRIMARY, MUTED, GREEN, Card, Empty, ago, fmtDate, pageWrap } from '../ui';

export const dynamic = 'force-dynamic';

const SORTS: [UserSort, string][] = [['activity', 'Most active'], ['games', 'Most games'], ['signup', 'Newest'], ['name', 'Name']];

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : '';
  const sort = (SORTS.some(([s]) => s === sp.sort) ? sp.sort : 'activity') as UserSort;
  const rows = await searchUsers(q, sort);

  const qsFor = (s: UserSort) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    p.set('sort', s);
    return `/admin/users?${p.toString()}`;
  };

  return (
    <main style={pageWrap}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '10px 0 14px' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Users</h1>
        <span style={{ fontSize: 12, color: MUTED }}>{rows.length}{rows.length >= 200 ? '+' : ''} {q ? 'matching' : 'total'}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <AdminSearch initial={q} sort={sort} placeholder="Search by name or email…" />
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
        {rows.length === 0 ? <Empty label={q ? 'No users match.' : 'No users yet.'} /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: MUTED, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Name</th>
                <th style={th}>Games</th>
                <th style={th}>Activity</th>
                <th style={th}>Teams</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Last active</th>
                <th style={{ padding: '6px 8px', fontWeight: 700 }}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} style={{ borderTop: '1px solid #1a1f27' }}>
                  <td style={{ padding: '7px 8px' }}>
                    <Link href={`/admin/users/${u.id}`} style={{ color: '#e6ebf2', fontWeight: 600, textDecoration: 'none' }}>{u.name ?? '(no name)'}</Link>
                    {u.email && <div style={{ color: MUTED, fontSize: 11 }}>{u.email}</div>}
                  </td>
                  <td style={tdNum}>{u.games.toLocaleString()}</td>
                  <td style={{ ...tdNum, color: u.activity ? GREEN : MUTED, fontWeight: 700 }}>{u.activity.toLocaleString()}</td>
                  <td style={tdNum}>{u.teams || '—'}</td>
                  <td style={{ padding: '7px 8px', color: '#9aa3b2' }}>{ago(u.lastActive)}</td>
                  <td style={{ padding: '7px 8px', color: '#9aa3b2' }}>{fmtDate(u.signup)}</td>
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
