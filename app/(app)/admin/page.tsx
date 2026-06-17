import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isAdmin } from '@/lib/admin';
import { loadAdminMetrics } from '@/lib/adminMetrics';
import { AdminDashboard } from './AdminDashboard';

// B157: internal operator dashboard. Gated to the KARABUDDY_ADMIN_EMAILS
// allowlist; everyone else gets a 404 (no hint the route exists).
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await auth();
  if (!isAdmin(session)) notFound();
  const metrics = await loadAdminMetrics();
  return <AdminDashboard metrics={metrics} />;
}
