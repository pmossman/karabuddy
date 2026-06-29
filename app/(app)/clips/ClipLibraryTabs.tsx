'use client';

import { ScopeTabs } from '@/app/_components/ScopeTabs';

// The /clips scope switcher — PERSONAL scopes only (My clips · On my replays).
// `active` is 'created' | 'on-my-replays'. B206: rides the shared ScopeTabs.
export function ClipLibraryTabs({ active }: { active: string }) {
  return (
    <ScopeTabs
      ariaLabel="Switch clip scope"
      active={active}
      items={[
        { key: 'created', label: 'My clips', href: '/clips' },
        { key: 'on-my-replays', label: 'On my replays', href: '/clips?tab=on-my-replays' },
      ]}
    />
  );
}
