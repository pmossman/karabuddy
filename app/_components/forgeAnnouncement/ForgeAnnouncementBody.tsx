import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { actions, headline, lede, moveCopy, sections, signOff, type Section } from './copy';
import { FULL_NOTE_PATH, SWU_FORGE_URL } from './constants';
import { showMoveSection, type ForgeTeamContext } from './rules';

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

export function ForgeAnnouncementBody({
  variant,
  teams,
  onNavigate,
}: {
  variant: 'modal' | 'page';
  teams: ForgeTeamContext;
  onNavigate?: () => void;
}) {
  const page = variant === 'page';
  const visible = sections.filter((s) => s.id !== 'move' || showMoveSection(variant, teams));

  return (
    <div style={{ fontFamily: f.font, color: f.text }}>
      <h2 style={{ margin: 0, fontSize: page ? 30 : 22, lineHeight: 1.2, fontWeight: 700, letterSpacing: '-0.01em', maxWidth: '22ch' }}>
        {headline}
      </h2>
      <p style={{ margin: page ? '14px 0 0' : '10px 0 0', fontSize: page ? 16.5 : 14.5, lineHeight: 1.6, color: f.text, opacity: 0.9, maxWidth: '62ch' }}>
        {lede}
      </p>

      {page && (
        <div style={{ marginTop: 22 }}>
          <a href={SWU_FORGE_URL} target="_blank" rel="noopener noreferrer" className="kbf-primary" style={forgeButton}>
            {actions.primary}
          </a>
        </div>
      )}

      <div style={{ marginTop: page ? 40 : 22, display: 'flex', flexDirection: 'column', gap: page ? 30 : 18 }}>
        {visible.map((s) => (
          <SectionBlock key={s.id} section={s} page={page}>
            {s.id === 'move' && <MoveTeams teams={teams} onNavigate={onNavigate} />}
          </SectionBlock>
        ))}
      </div>

      <p style={{ margin: page ? '36px 0 0' : '18px 0 0', fontSize: page ? 16 : 14, fontWeight: 600, color: f.text }}>{signOff}</p>
    </div>
  );
}

function SectionBlock({ section, page, children }: { section: Section; page: boolean; children?: ReactNode }) {
  const body: CSSProperties = { margin: '6px 0 0', fontSize: page ? 15.5 : 14, lineHeight: 1.6, color: f.text, opacity: 0.86, maxWidth: '64ch' };
  const panel: CSSProperties | undefined =
    section.id === 'move' ? { padding: page ? '18px 20px' : '14px 16px', background: f.softBg, border: `1px solid ${f.softBorder}`, borderRadius: f.radius } : undefined;
  return (
    <section style={panel}>
      <h3 style={{ margin: 0, fontSize: page ? 18 : 14.5, fontWeight: 700, color: f.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, transform: 'rotate(45deg)', background: sectionTick(section.id), flexShrink: 0 }} />
        {section.heading}
      </h3>
      {section.short && <p style={body}>{section.short}</p>}
      {section.bullets && (
        <ul style={{ ...body, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
      {children}
      {page && section.more && <p style={{ ...body, color: f.textMuted, opacity: 1 }}>{section.more}</p>}
    </section>
  );
}

function sectionTick(id: Section['id']): string {
  return id === 'karabuddy' || id === 'hosting' || id === 'why' ? f.markOrange : f.markBlue;
}

function MoveTeams({ teams, onNavigate }: { teams: ForgeTeamContext; onNavigate?: () => void }) {
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
                <Link href={`/teams/${t.slug}/move`} prefetch={false} onClick={onNavigate} className="kbf-soft" style={{ ...forgeButton, padding: '6px 12px', fontSize: 13 }}>
                  {moveCopy.ownerLink}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {teams.memberTeamCount > 0 && <p style={note}>{owned.length > 0 ? moveCopy.memberToo : moveCopy.memberOnly}</p>}
    </>
  );
}

export function FullNoteLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href={FULL_NOTE_PATH} prefetch={false} onClick={onNavigate} className="kbf-quiet" style={forgeButton}>
      {actions.fullNote}
    </Link>
  );
}
