import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { canSeeMigrateDemo } from '@/lib/migrateDemoAccess';
import MigrationDemo from './MigrationDemo';

// DEMO route: karabuddy → SWU Forge team migration (faked data, no backend — for
// feedback). Server page: gates access + holds metadata; the interactive wizard
// is the client component MigrationDemo. Lives in the (app) group so it renders
// inside the real karabuddy shell (sidebar + header + footer).
//
// Access-gated to an email allowlist (KARABUDDY_MIGRATE_DEMO_EMAILS) — Parker +
// Andy only in prod. Everyone else 404s (no hint the route exists).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Migrate to SWU Forge — demo',
  description: 'Interactive demo of the karabuddy → SWU Forge team migration (faked data).',
  robots: { index: false, follow: false },
};

export default async function MigrateDemoPage() {
  const session = await auth();
  if (!canSeeMigrateDemo(session)) notFound();
  return <MigrationDemo />;
}
