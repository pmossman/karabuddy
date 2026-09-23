import Link from 'next/link';
import { Panel } from '@/app/_components/Panel';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Team-settings entry point for the KaraBuddy → SWU Forge move. Owners only,
// and only once `forgeMigrationEnabled()` — the page gates both, so this
// component is purely the card.
//
// It is an entry point, not the action: nothing leaves KaraBuddy until the
// owner confirms on the preview screen, which is where the dry run happens and
// where the roster is decided. Deliberately a card in Team Settings rather than
// a banner or a nav item — the owner goes looking and finds it where teams are
// already managed.
export function MoveTeamToForge({
  slug,
  teamName,
  memberCount,
}: {
  slug: string;
  teamName: string;
  memberCount: number;
}) {
  return (
    <Panel accent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 240, flex: '1 1 320px' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: tokens.color.text }}>
            Move this team to SWU Forge
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: tokens.color.textSecondary, lineHeight: 1.5 }}>
            Creates <strong style={{ color: tokens.color.text }}>{teamName}</strong> on SWU Forge and invites{' '}
            {memberCount === 1 ? 'you' : `all ${memberCount} members`}. Decks, replays and stats do not come
            along — your KaraBuddy team is unaffected.
          </p>
        </div>
        <Link
          href={`/teams/${slug}/move`}
          data-testid="move-to-forge"
          style={{ ...glowButtonStyle, whiteSpace: 'nowrap' }}
        >
          Move team
        </Link>
      </div>
      <p style={{ margin: 0, fontSize: 11.5, color: tokens.color.textMuted, lineHeight: 1.5 }}>
        You&apos;ll see the full roster and pick everyone&apos;s role before anything is sent.
      </p>
    </Panel>
  );
}
