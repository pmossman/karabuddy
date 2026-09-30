import type { Metadata } from 'next';
import { auth } from '@/auth';
import { getMyTeams } from '@/lib/activeTeam';
import { forgeMigrationEnabled } from '@/lib/forgeMigration';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ForgeWordmark } from '@/app/_components/forgeAnnouncement/ForgeMark';
import { ForgeAnnouncementBody, forgeStyles } from '@/app/_components/forgeAnnouncement/ForgeAnnouncementBody';
import { headline } from '@/app/_components/forgeAnnouncement/copy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'KaraBuddy and SWU Forge — KaraBuddy',
  description: headline,
};

const f = tokens.forge;

export default async function SwuForgePage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const teams = userId ? await getMyTeams(userId) : [];
  const ownedTeams = teams.filter((t) => t.role === 'owner').map(({ slug, name }) => ({ slug, name }));

  return (
    <div style={{ background: f.bg, minHeight: '100%', color: f.text, fontFamily: f.font }}>
      <style>{forgeStyles}</style>
      <div style={{ background: f.headerBg, borderBottom: `1px solid ${f.border}` }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '18px 28px' }}>
          <ForgeWordmark size={28} fontSize={19} />
        </div>
      </div>
      <article style={{ maxWidth: 760, margin: '0 auto', padding: '40px 28px 80px' }}>
        <ForgeAnnouncementBody
          variant="page"
          teams={{ signedIn: !!userId, ownedTeams, memberTeamCount: teams.length - ownedTeams.length, canMove: forgeMigrationEnabled() }}
        />
      </article>
    </div>
  );
}
