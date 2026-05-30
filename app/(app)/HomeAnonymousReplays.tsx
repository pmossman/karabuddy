'use client';

import { MineAnonymous } from '@/app/(app)/replays/MineAnonymous';

// B70: signed-out home leads with the visitor's own (anonymous) recent
// replays, probed from the extension's install token. Reuses the same
// MineAnonymous flow as /replays?tab=mine — which falls through to the
// install pitch (MineEmpty) when no extension is present.
export function HomeAnonymousReplays() {
  return (
    <section data-testid="home-recent-replays">
      <MineAnonymous />
    </section>
  );
}
