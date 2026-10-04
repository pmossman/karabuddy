'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Modal } from '@/app/_components/Modal';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ForgeMark, ForgeWordmark } from './ForgeMark';
import { ForgeAnnouncementBody, forgeButton, forgeStyles } from './ForgeAnnouncementBody';
import { actions, headline, hubCopy } from './copy';
import { FORGE_ANNOUNCEMENT_VERSION, HUB_PATH, SWU_FORGE_URL } from './constants';
import { isDismissed, shouldAutoOpen, type ForgeTeamContext } from './rules';

const f = tokens.forge;
const DISMISSAL_URL = '/api/me/announcement-dismissal';
const DISMISSAL_CHANNEL = 'kb:announcement-dismissal';

interface Ctx {
  open: () => void;
  seen: boolean;
}

const ForgeAnnouncementContext = createContext<Ctx | null>(null);

export function ForgeAnnouncementProvider({
  userId,
  dismissedVersion,
  teams,
  children,
}: {
  userId: string | null;
  dismissedVersion: number | null;
  teams: ForgeTeamContext;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [dismissedHere, setDismissedHere] = useState(false);
  const seen = !userId || dismissedHere || isDismissed(dismissedVersion);
  const channel = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (shouldAutoOpen({ signedIn: !!userId, dismissed: seen, pathname, search: window.location.search })) setIsOpen(true);
  }, [userId, seen, pathname]);

  useEffect(() => {
    if (!userId || typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(DISMISSAL_CHANNEL);
    c.onmessage = (e: MessageEvent<{ userId?: string; version?: number }>) => {
      if (e.data?.userId !== userId || !isDismissed(e.data.version ?? null)) return;
      setIsOpen(false);
      setDismissedHere(true);
    };
    channel.current = c;
    return () => {
      c.close();
      channel.current = null;
    };
  }, [userId]);

  const close = useCallback(() => {
    setIsOpen(false);
    if (seen) return;
    setDismissedHere(true);
    channel.current?.postMessage({ userId, version: FORGE_ANNOUNCEMENT_VERSION });
    fetch(DISMISSAL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: FORGE_ANNOUNCEMENT_VERSION }),
      keepalive: true,
    }).catch(() => {});
  }, [userId, seen]);

  const open = useCallback(() => setIsOpen(true), []);

  return (
    <ForgeAnnouncementContext.Provider value={{ open, seen }}>
      <style>{forgeStyles}</style>
      {children}
      <Modal open={isOpen} onClose={close} ariaLabel={headline} width="min(600px, 96vw)" maxHeight="90vh">
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', background: f.headerBg, borderBottom: `1px solid ${f.border}` }}>
          <ForgeWordmark size={24} fontSize={17} />
          <button type="button" onClick={close} className="kbf-quiet" style={{ ...forgeButton, padding: '6px 10px', fontSize: 13 }}>
            {actions.close}
          </button>
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '22px 24px 24px', background: f.bg }}>
          <ForgeAnnouncementBody teams={teams} onNavigate={close} />
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 10, padding: '12px 20px', background: f.headerBg, borderTop: `1px solid ${f.border}` }}>
          {pathname !== HUB_PATH && (
            <Link href={HUB_PATH} prefetch={false} onClick={close} className="kbf-quiet" style={forgeButton}>
              {actions.hub}
            </Link>
          )}
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
  const pathname = usePathname();
  const showNew = !!ctx && !ctx.seen;

  const style =
    variant === 'sidebar'
      ? { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` }
      : variant === 'header'
        ? { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` }
        : { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: f.radius, background: f.surface, border: `1px solid ${f.border}` };

  return (
    <Link
      href={HUB_PATH}
      prefetch={false}
      aria-label={variant === 'icon' ? (showNew ? 'SWU Forge (new)' : 'SWU Forge') : undefined}
      aria-current={pathname === HUB_PATH ? 'page' : undefined}
      title={variant === 'icon' ? 'SWU Forge' : undefined}
      className="kbf-nav kbf-glow"
      style={{ ...style, boxSizing: 'border-box', fontFamily: f.font, cursor: 'pointer', textDecoration: 'none', position: 'relative' }}
    >
      {variant === 'icon' ? (
        <>
          <ForgeMark size={20} />
          {showNew && (
            <span aria-hidden="true" style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 999, background: f.markOrange, border: `2px solid ${f.headerBg}` }} />
          )}
        </>
      ) : (
        <>
          <ForgeMark size={variant === 'sidebar' ? 20 : 18} />
          <span style={{ fontSize: variant === 'sidebar' ? 14 : 13, fontWeight: 700, letterSpacing: '0.02em', color: f.text, whiteSpace: 'nowrap' }}>SWU Forge</span>
          {showNew && (
            <span style={{ marginLeft: variant === 'sidebar' ? 'auto' : 0, padding: '1px 6px', borderRadius: 999, background: f.markOrange, color: f.headerBg, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.5 }}>
              New
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export function ForgeLetterButton() {
  const ctx = useContext(ForgeAnnouncementContext);
  if (!ctx) return null;
  return (
    <button type="button" onClick={ctx.open} className="kbf-soft" style={forgeButton}>
      {hubCopy.letterButton}
    </button>
  );
}
