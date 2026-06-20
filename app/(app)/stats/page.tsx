import { auth } from '@/auth';
import { StatsClient } from './StatsClient';

// "My Stats" — the personal stats surface. Team stats live in the team page
// (/teams/<slug>?tab=stats), a separate surface. Scope is personal only here.
export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  const session = await auth();
  const userId = (session?.user?.id as string | undefined) || null;
  return <StatsClient scope="personal" signedIn={!!userId} />;
}
