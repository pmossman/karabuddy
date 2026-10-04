import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { lede, moveCopy, movedCopy, sections, signOff, type Section } from './copy';
import { showMoveSection, type ForgeTeamContext, type MovedTeam } from './rules';
import { hubMovePath } from './constants';

const f = tokens.forge;

export const forgeStyles = `
  .kbf-primary { background: ${f.accent}; border: 1px solid ${f.accent}; color: #fff; }
  .kbf-primary:hover { background: ${f.accentHover}; border-color: ${f.accentHover}; }
  .kbf-soft { background: ${f.softBg}; border: 1px solid ${f.softBorder}; color: ${f.softText}; }
  .kbf-soft:hover { border-color: ${f.softText}; color: #fff; }
  .kbf-quiet { background: transparent; border: 1px solid transparent; color: ${f.textMuted}; }
  .kbf-quiet:hover { color: ${f.text}; }
  .kbf-nav { transition: border-color 0.18s ease; }
  .kbf-nav:hover { border-color: ${f.softBorder} !important; }
  .kbf-glow { background: ${f.glowTint}, ${f.surface} !important; border-color: ${f.glowRing} !important; animation: kbf-glow 3.2s ease-in-out infinite; }
  .kbf-glow:hover { border-color: ${f.softText} !important; box-shadow: 0 0 0 1px ${f.glowRing}, 0 0 20px 0 ${f.glowStrong}; }
  @keyframes kbf-glow {
    0%, 100% { box-shadow: 0 0 0 1px ${f.glowRing}, 0 0 10px -3px ${f.glowSoft}; }
    50% { box-shadow: 0 0 0 1px ${f.glowRing}, 0 0 18px -1px ${f.glowStrong}, 0 0 28px -8px ${f.glowWarm}; }
  }
  @media (prefers-reduced-motion: reduce) { .kbf-glow { animation: none; box-shadow: 0 0 0 1px ${f.glowRing}, 0 0 14px -2px ${f.glowSoft}; } }
  .kbf-primary:focus-visible, .kbf-soft:focus-visible, .kbf-quiet:focus-visible, .kbf-nav:focus-visible { outline: 2px solid ${f.markBlue}; outline-offset: 2px; }
`;

export const forgeButton: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 16px', borderRadius: f.radius, fontFamily: f.font, fontSize: 14, fontWeight: 600,
  textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease',
};

export function ForgeAnnouncementBody({ teams, onNavigate }: { teams: ForgeTeamContext; onNavigate?: () => void }) {
  const visible = sections.filter((s) => s.id !== 'move' || showMoveSection(teams));

  return (
    <div style={{ fontFamily: f.font, color: f.text }}>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: f.text, opacity: 0.9, maxWidth: '62ch' }}>
        {lede}
      </p>

      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {visible.map((s) => (
          <SectionBlock key={s.id} section={s}>
            {s.id === 'move' && <MoveTeams teams={teams} onNavigate={onNavigate} />}
          </SectionBlock>
        ))}
      </div>

      <p style={{ margin: '18px 0 0', fontSize: 14, fontWeight: 600, color: f.text }}>{signOff}</p>
    </div>
  );
}

function SectionBlock({ section, children }: { section: Section; children?: ReactNode }) {
  const body: CSSProperties = { margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };
  const panel: CSSProperties | undefined =
    section.id === 'move' ? { padding: '14px 16px', background: f.softBg, border: `1px solid ${f.softBorder}`, borderRadius: f.radius } : undefined;
  return (
    <section style={panel}>
      <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: f.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <SectionTick color={sectionTick(section.id)} />
        {section.heading}
      </h3>
      {section.short && <p style={body}>{section.short}</p>}
      {section.bullets && (
        <ul style={{ ...body, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {children}
    </section>
  );
}

export function SectionTick({ color, size = 6 }: { color: string; size?: number }) {
  return <span aria-hidden="true" style={{ width: size, height: size, transform: 'rotate(45deg)', background: color, flexShrink: 0 }} />;
}

function sectionTick(id: Section['id']): string {
  return id === 'karabuddy' || id === 'hosting' || id === 'why' ? f.markOrange : f.markBlue;
}

export function MoveTeams({ teams, onNavigate, detailed }: { teams: ForgeTeamContext; onNavigate?: () => void; detailed?: boolean }) {
  const note: CSSProperties = { margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };
  if (!teams.signedIn) return <p style={note}>{moveCopy.signedOut}</p>;
  const owned = teams.ownedTeams;
  return (
    <>
      {owned.length > 0 && (
        <>
          <p style={note}>{moveCopy.ownerIntro(owned.length)}</p>
          <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, border: `1px solid ${f.border}`, borderRadius: f.radius, background: f.surface, overflow: 'hidden' }}>
            {owned.map((t, i) => (
              <li
                key={t.slug}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 12px', borderTop: i === 0 ? 'none' : `1px solid ${f.border}` }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                <Link href={hubMovePath(t.slug)} prefetch={false} onClick={onNavigate} className="kbf-soft" style={{ ...forgeButton, padding: '6px 12px', fontSize: 13 }}>
                  {moveCopy.ownerLink}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <MemberTeamLines teams={teams} detailed={detailed} />
    </>
  );
}

export function MemberTeamLines({ teams, detailed = false }: { teams: ForgeTeamContext; detailed?: boolean }) {
  const note: CSSProperties = { margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };
  const notMoved = teams.memberTeamCount - teams.movedMemberTeams.length;
  return (
    <>
      {teams.movedMemberTeams.map((t) =>
        detailed ? (
          <MovedTeamDetails key={t.slug} team={t} />
        ) : (
          <p key={t.slug} style={note}>
            {moveCopy.memberMoved(t.name)}{' '}
            <a href={t.url} target="_blank" rel="noopener noreferrer" style={inlineLink}>
              {movedCopy.open}
            </a>
          </p>
        ),
      )}
      {notMoved > 0 && <p style={note}>{teams.ownedTeams.length > 0 ? moveCopy.memberToo : moveCopy.memberOnly}</p>}
    </>
  );
}

export const inlineLink: CSSProperties = { color: f.softText, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 };

export function MovedGuidance({ style }: { style?: CSSProperties }) {
  return <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch', ...style }}>{movedCopy.guidance.join(' ')}</p>;
}

function MovedTeamDetails({ team }: { team: MovedTeam }) {
  return (
    <div style={{ marginTop: 6, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{movedCopy.title(team.name)}</span>
        <a href={team.url} target="_blank" rel="noopener noreferrer" className="kbf-primary" style={{ ...forgeButton, padding: '6px 12px', fontSize: 13 }}>
          {movedCopy.open}
        </a>
      </div>
      <MovedGuidance />
    </div>
  );
}
