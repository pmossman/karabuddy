import { loadAdminMetrics } from '@/lib/adminMetrics';
import { AdminDashboard } from './AdminDashboard';

// B157: internal operator overview. Section gate lives in layout.tsx.
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const metrics = await loadAdminMetrics();
  return <AdminDashboard metrics={metrics} />;
}
