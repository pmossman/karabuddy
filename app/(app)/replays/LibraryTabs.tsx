'use client';

import { ScopeTabs } from '@/app/_components/ScopeTabs';

// The /replays scope switcher — PERSONAL + discovery only: "My replays" and the
// 🌐 Public browse. Team replays moved to the team page. `activeSlug` is null
// (My replays) | 'public'. B206: rides the shared ScopeTabs.
export function LibraryTabs({ activeSlug }: { activeSlug: string | null }) {
  return (
    <ScopeTabs
      ariaLabel="Switch replay scope"
      active={activeSlug === 'public' ? 'public' : 'mine'}
      items={[
        { key: 'mine', label: 'My replays', href: '/replays' },
        { key: 'public', label: '🌐 Public', href: '/replays?tab=public' },
      ]}
    />
  );
}
