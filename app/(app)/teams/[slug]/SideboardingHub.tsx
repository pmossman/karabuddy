'use client';

// B231: the Sideboarding tab has two modes — the drill gauntlet (B227) and the
// matchup Guides. A segmented toggle switches between them (?mode=guides), so
// all sideboarding lives under one tab.

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { TeamSideboarding } from './TeamSideboarding';
import { TeamSideboardGuides } from './TeamSideboardGuides';
import { tokens } from '@/app/_theme/karabuddyTokens';

const CYAN = '#66E5FF';

export function SideboardingHub({ teamSlug, members, viewerName }: {
  teamSlug: string; members: { userId: string; name: string | null }[]; viewerName: string;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode = sp.get('mode') === 'guides' ? 'guides' : 'drills';

  const go = (m: 'drills' | 'guides') => {
    const params = new URLSearchParams(sp.toString());
    if (m === 'guides') params.set('mode', 'guides'); else params.delete('mode');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'inline-flex', alignSelf: 'center', background: tokens.surface.panel, border: `1px solid ${tokens.surface.panelBorder}`, borderRadius: 999, padding: 3 }}>
        {(['drills', 'guides'] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`sideboard-mode-${m}`}
            aria-pressed={mode === m}
            onClick={() => go(m)}
            style={{
              border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              padding: '6px 18px', borderRadius: 999,
              background: mode === m ? 'rgba(102,229,255,0.15)' : 'transparent',
              color: mode === m ? CYAN : '#8a93a3',
            }}
          >
            {m === 'drills' ? 'Drills' : 'Guides'}
          </button>
        ))}
      </div>
      {mode === 'drills'
        ? <TeamSideboarding teamSlug={teamSlug} members={members} viewerName={viewerName} />
        : <TeamSideboardGuides teamSlug={teamSlug} viewerName={viewerName} />}
    </div>
  );
}
