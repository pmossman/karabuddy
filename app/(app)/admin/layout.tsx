import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isAdmin } from '@/lib/admin';
import { AdminNav } from './AdminNav';

// B157: gate the whole /admin section once. Non-allowlisted → 404 (no hint the
// route exists). Every /admin/* page renders inside this + the section sub-nav.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!isAdmin(session)) notFound();
  return (
    <div>
      <AdminNav />
      {children}
    </div>
  );
}
