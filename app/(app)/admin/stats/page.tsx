import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isAdmin } from '@/lib/admin';
import { StatsClient } from '@/app/(app)/stats/StatsClient';

// Admin-only WHOLE-META stats — the same StatsClient UI as /stats, at
// scope="global" (leader matchup matrix + card stats + drill-in across every
// recorded game). Gated to KARABUDDY_ADMIN_EMAILS (404 otherwise, no hint the
// route exists). Built to eventually go public: the global scope is aggregate-
// only (no per-replay drill-in) and honors users.exclude_from_global_stats
// server-side, so opening it up later is just dropping this gate.
export const dynamic = 'force-dynamic';

export default async function AdminStatsPage() {
  const session = await auth();
  if (!isAdmin(session)) notFound();
  return <StatsClient scope="global" signedIn />;
}
