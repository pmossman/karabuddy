'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Modal } from '@/app/_components/Modal';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ForgeMark, ForgeWordmark } from './ForgeMark';
import { ForgeAnnouncementBody, FullNoteLink, forgeButton, forgeStyles } from './ForgeAnnouncementBody';
import { actions, sections } from './copy';
import { FULL_NOTE_PATH, SWU_FORGE_URL } from './constants';
import { dismissalKey, shouldAutoOpen, type ForgeTeamContext } from './rules';

const f = tokens.forge;

interface Ctx {
  open: () => void;
  seen: boolean;
}

const ForgeAnnouncementContext = createContext<Ctx | null>(null);

export function ForgeAnnouncementProvider({
  userId,
  teams,
  children,
}: {
  userId: string | null;
  teams: ForgeTeamContext;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [seen, setSeen] = useState(true);

  const persist = useCallback(() => {
    setSeen(true);
    try {
      window.localStorage.setItem(dismissalKey(userId), '1');
    } catch {}
  }, [userId]);

  useEffect(() => {
    let dismissed = true;
    try {
      dismissed = window.localStorage.getItem(dismissalKey(userId)) === '1';
    } catch {}
    setSeen(dismissed);
    if (shouldAutoOpen({ signedIn: !!userId, pathname: window.location.pathname, dismissed })) setIsOpen(true);
  }, [userId]);

  useEffect(() => {
    if (pathname === FULL_NOTE_PATH) persist();
  }, [pathname, persist]);

  const close = useCallback(() => {
    setIsOpen(false);
    persist();
  }, [persist]);

  const open = useCallback(() => setIsOpen(true), []);

  return (
    <ForgeAnnouncementContext.Provider value={{ open, seen }}>
      <style>{forgeStyles}</style>
      {children}
      <Modal open={isOpen} onClose={close} ariaLabel="A note about KaraBuddy and SWU Forge" width="min(600px, 96vw)" maxHeight="90vh">
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', background: f.headerBg, borderBottom: `1px solid ${f.border}` }}>
          <ForgeWordmark size={24} fontSize={17} />
          <button type="button" onClick={close} className="kbf-quiet" style={{ ...forgeButton, padding: '6px 10px', fontSize: 13 }}>
            {actions.close}
          </button>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '22px 24px 24px', background: f.bg }}>
          <ForgeAnnouncementBody variant="modal" teams={teams} onNavigate={close} />
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, padding: '12px 20px', background: f.headerBg, borderTop: `1px solid ${f.border}` }}>
          {pathname !== FULL_NOTE_PATH && sections.some((section) => section.more) && <FullNoteLink onNavigate={close} />}
          <a href={SWU_FORGE_URL} target="_blank" rel="noopener noreferrer" onClick={close} className="kbf-primary" style={forgeButton}>
            {actions.primary}
          </a>
        </div>
      </Modal>
    </ForgeAnnouncementContext.Provider>
  );
}

export function ForgeAnnouncementButton({ variant }: { variant: 'sidebar' | 'icon' | 'header' }) {
  const ctx = useContext(ForgeAnnouncementContext);
  const showNew = !!ctx && !ctx.seen;
  const label = 'SWU Forge: a note about KaraBuddy';

  const style =
    variant === 'sidebar'
      ? { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` }
      : variant === 'header'
        ? { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` }
        : { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` };

  const content =
    variant === 'icon' ? (
      <ForgeMark size={20} />
    ) : (
      <>
        <ForgeMark size={variant === 'sidebar' ? 20 : 18} />
        <span style={{ fontSize: variant === 'sidebar' ? 14 : 13, fontWeight: 700, letterSpacing: '0.02em', color: f.text, whiteSpace: 'nowrap' }}>SWU Forge</span>
        {showNew && (
          <span style={{ marginLeft: variant === 'sidebar' ? 'auto' : 0, padding: '1px 6px', borderRadius: 999, background: f.markOrange, color: '#fff', fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.5 }}>
            New
          </span>
        )}
      </>
    );

  const common = { ...style, fontFamily: f.font, cursor: 'pointer', textDecoration: 'none', position: 'relative' as const };

  if (!ctx) {
    return (
      <Link href={FULL_NOTE_PATH} prefetch={false} aria-label={label} title={label} className="kbf-nav" style={common}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={ctx.open} aria-label={label} title={label} className="kbf-nav" style={common}>
      {content}
      {variant === 'icon' && showNew && (
        <span aria-hidden="true" style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 999, background: f.markOrange, border: `2px solid ${f.headerBg}` }} />
      )}
    </button>
  );
}
