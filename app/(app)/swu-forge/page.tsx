import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { auth } from '@/auth';
import { getMyTeams } from '@/lib/activeTeam';
import { forgeMigrationEnabled } from '@/lib/forgeMigration';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ForgeMark } from '@/app/_components/forgeAnnouncement/ForgeMark';
import { ForgeLetterButton } from '@/app/_components/forgeAnnouncement/ForgeAnnouncement';
import { MoveTeams, SectionTick, forgeButton } from '@/app/_components/forgeAnnouncement/ForgeAnnouncementBody';
import { actions, hubCopy } from '@/app/_components/forgeAnnouncement/copy';
import { KARABUDDY_DISCORD_URL, SWU_FORGE_DISCORD_URL, SWU_FORGE_DOCS_URL, SWU_FORGE_URL } from '@/app/_components/forgeAnnouncement/constants';
import { showMoveSection, type ForgeTeamContext } from '@/app/_components/forgeAnnouncement/rules';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SWU Forge — KaraBuddy',
  description: hubCopy.intro,
};

const f = tokens.forge;

const hubStyles = `
  .kbf-hub { container-type: inline-size; }
  .kbf-hub-wrap { max-width: 880px; margin: 0 auto; padding: 52px 28px 88px; display: flex; flex-direction: column; gap: 48px; }
  .kbf-hub-move { padding: 26px 28px 28px; background: ${f.softBg}; border: 1px solid ${f.softBorder}; border-radius: ${f.radius * 1.5}px; box-shadow: 0 0 0 1px ${f.glowRing}, 0 0 32px -10px ${f.glowStrong}; }
  .kbf-hub-move-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 32px; margin-top: 14px; }
  .kbf-hub-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; margin-top: 26px; }
  .kbf-link { color: ${f.softText}; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
  .kbf-link:hover { color: #fff; }
  .kbf-link:focus-visible { outline: 2px solid ${f.markBlue}; outline-offset: 2px; border-radius: 2px; }
  @container (max-width: 720px) {
    .kbf-hub-wrap { padding: 32px 16px 64px; gap: 40px; }
    .kbf-hub-move { padding: 20px 18px 22px; }
    .kbf-hub-move-grid, .kbf-hub-features { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  }
`;

const h2: CSSProperties = { margin: 0, fontSize: 21, lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.005em', display: 'flex', alignItems: 'center', gap: 10 };
const h3: CSSProperties = { margin: 0, fontSize: 15.5, lineHeight: 1.3, fontWeight: 700 };
const body: CSSProperties = { margin: '6px 0 0', fontSize: 15, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };

function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="kbf-link" style={{ fontSize: 14 }}>
      {children}
    </a>
  );
}

export default async function SwuForgeHubPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const myTeams = userId ? await getMyTeams(userId) : [];
  const ownedTeams = myTeams.filter((t) => t.role === 'owner').map(({ slug, name }) => ({ slug, name }));
  const teams: ForgeTeamContext = { signedIn: !!userId, ownedTeams, memberTeamCount: myTeams.length - ownedTeams.length, canMove: forgeMigrationEnabled() };
  const mayOwn = !teams.signedIn || ownedTeams.length > 0;
  const facts = hubCopy.move.facts.filter((fact) => mayOwn || !fact.ownerOnly);
  const { learn, community } = hubCopy;

  return (
    <div className="kbf-hub" style={{ background: f.bg, minHeight: '100%', color: f.text, fontFamily: f.font }}>
      <style>{hubStyles}</style>
      <div className="kbf-hub-wrap">
        <header>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 16, fontSize: 'clamp(30px, 6cqi, 40px)', lineHeight: 1.1, fontWeight: 700, letterSpacing: '0.01em' }}>
            <ForgeMark size={52} />
            SWU Forge
          </h1>
          <p style={{ margin: '18px 0 0', fontSize: 17, lineHeight: 1.55, color: f.text, opacity: 0.9, maxWidth: '52ch' }}>{hubCopy.intro}</p>
          <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a href={SWU_FORGE_URL} target="_blank" rel="noopener noreferrer" className="kbf-primary" style={forgeButton}>
              {actions.primary}
            </a>
            <ForgeLetterButton />
          </div>
        </header>

        {showMoveSection(teams) && (
          <section className="kbf-hub-move" aria-labelledby="hub-move">
            <h2 id="hub-move" style={h2}>
              <SectionTick color={f.markBlue} size={7} />
              {hubCopy.move.heading}
            </h2>
            <div className="kbf-hub-move-grid">
              <div>
                <MoveTeams teams={teams} />
              </div>
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {facts.map((fact) => (
                  <li key={fact.text} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.55, color: f.text, opacity: 0.88 }}>
                    <span style={{ marginTop: 8, display: 'inline-flex' }}>
                      <SectionTick color={f.softText} size={5} />
                    </span>
                    {fact.text}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <section aria-labelledby="hub-learn">
          <h2 id="hub-learn" style={h2}>
            <SectionTick color={f.markBlue} size={7} />
            {learn.heading}
          </h2>
          <div style={{ marginTop: 18 }}>
            <h3 style={{ ...h3, fontSize: 17 }}>{learn.replays.title}</h3>
            <p style={{ ...body, fontSize: 16 }}>{learn.replays.body}</p>
            <p style={{ margin: '8px 0 0' }}>
              <ExtLink href={learn.replays.link.href}>{learn.replays.link.label}</ExtLink>
            </p>
          </div>
          <div className="kbf-hub-features">
            {learn.features.map((feature) => (
              <div key={feature.title} style={{ paddingTop: 16, borderTop: `1px solid ${f.border}` }}>
                <h3 style={h3}>{feature.title}</h3>
                <p style={{ ...body, fontSize: 14.5 }}>{feature.body}</p>
                <p style={{ margin: '8px 0 0' }}>
                  <ExtLink href={feature.link.href}>{feature.link.label}</ExtLink>
                </p>
              </div>
            ))}
          </div>
          <p style={{ margin: '26px 0 0', fontSize: 14.5, lineHeight: 1.6, color: f.textMuted, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            <span>{learn.soon}</span>
            <ExtLink href={SWU_FORGE_DOCS_URL}>{learn.docs}</ExtLink>
          </p>
        </section>

        <section aria-labelledby="hub-community">
          <h2 id="hub-community" style={h2}>
            <SectionTick color={f.markOrange} size={7} />
            {community.heading}
          </h2>
          <p style={body}>{community.body}</p>
          <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <a href={KARABUDDY_DISCORD_URL} target="_blank" rel="noopener noreferrer" className="kbf-soft" style={forgeButton}>
              {community.karabuddyDiscord}
            </a>
            <a href={SWU_FORGE_DISCORD_URL} target="_blank" rel="noopener noreferrer" className="kbf-soft" style={forgeButton}>
              {community.forgeDiscord}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
