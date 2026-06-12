'use client';

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShareWithTeam } from '@/app/(app)/r/[slug]/ShareWithTeam';
import { ReplayDecksModal } from './ReplayDecksModal';
import { ReplayCommentsModal } from './ReplayCommentsModal';

// B100: per-row kebab (⋮) menu of common actions. The frequent one —
// flipping which teams a replay is shared with — lives inline as toggles
// right in the menu (no heavy overlay). Heavier/rarer things (decks, open,
// delete) are menu items. Replaces the old "Manage" button + modal.

interface ActionRow {
  slug: string;
  players: any;
  displayName?: string | null;
  ownerPlayerId?: string | null;
  // B100: viewer owns this specific replay. On the team grid `canManage` is
  // false grid-wide, but the owner of an individual replay can still manage
  // it (e.g. un-share). ShareWithTeam re-checks ownership server-side.
  isMine?: boolean;
}

const MENU_WIDTH = 248;

export function RowActions({ replay, canManage }: { replay: ActionRow; canManage: boolean }) {
  // Sharing is available to whoever owns the replay; delete stays gated to
  // the personal library (canManage) — we don't delete others' replays, and
  // deleting from a team grid would be surprising.
  const canShare = canManage || !!replay.isMine;
  const canDelete = canManage;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [decksOpen, setDecksOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const players = Array.isArray(replay.players) ? replay.players : [];
  const title = replay.displayName || `${nameText(players[0])} vs ${nameText(players[1])}`;

  // Anchor the fixed menu under the kebab, right-aligned. Fixed positioning
  // escapes the table's overflow-x clip; clamp into the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setCoords({ top: r.bottom + 4, left });
  }, [open]);

  // Dismiss on outside click, Esc, or scroll/resize (position would drift).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const remove = async () => {
    if (!confirm('Delete this replay? This cannot be undone.')) return;
    setOpen(false);
    const res = await fetch(`/api/replays/${replay.slug}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) {
      alert(`Failed to delete: ${body.error || 'unknown'}`);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid={`row-actions-${replay.slug}`}
        aria-label="Replay actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: open ? 'rgba(77, 157, 255, 0.12)' : 'transparent',
          border: '1px solid ' + (open ? 'rgba(77, 157, 255, 0.5)' : '#2e333c'),
          color: '#a0a8b8',
          width: 28,
          height: 26,
          borderRadius: 5,
          fontSize: 16,
          lineHeight: 1,
          cursor: isPending ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isPending ? 0.5 : 1,
        }}
      >
        ⋮
      </button>

      {open && coords && (
        <div
          ref={menuRef}
          role="menu"
          data-testid={`row-menu-${replay.slug}`}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: MENU_WIDTH,
            zIndex: 210,
            background: '#11141a',
            border: '1px solid #2e333c',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            padding: 6,
            color: '#e6e6e6',
            fontFamily: 'var(--font-barlow), sans-serif',
            // The table's actions cell sets white-space: nowrap; reset it here
            // so menu copy (share helper text, the confirm modal) wraps.
            whiteSpace: 'normal',
            textAlign: 'left',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {canShare && (
            <>
              <div style={{ padding: '4px 8px 2px' }}>
                <ShareWithTeam replaySlug={replay.slug} installToken="" />
              </div>
              <Divider />
            </>
          )}
          <MenuItem onClick={() => { setOpen(false); setCommentsOpen(true); }}>View comments</MenuItem>
          <MenuItem onClick={() => { setOpen(false); setDecksOpen(true); }}>View decks</MenuItem>
          <MenuLink href={`/r/${replay.slug}`}>Open replay</MenuLink>
          {canDelete && (
            <>
              <Divider />
              <MenuItem danger onClick={remove}>Delete</MenuItem>
            </>
          )}
        </div>
      )}

      {decksOpen && (
        <ReplayDecksModal
          replaySlug={replay.slug}
          title={title}
          localPlayerId={replay.ownerPlayerId ?? null}
          onClose={() => setDecksOpen(false)}
        />
      )}

      {commentsOpen && (
        <ReplayCommentsModal
          replaySlug={replay.slug}
          title={title}
          onClose={() => setCommentsOpen(false)}
        />
      )}
    </>
  );
}

function MenuItem({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={itemStyle(danger, hover)}
    >
      {children}
    </button>
  );
}

function MenuLink({ children, href }: { children: React.ReactNode; href: string }) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      prefetch={false}
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...itemStyle(false, hover), textDecoration: 'none', display: 'block' }}
    >
      {children}
    </Link>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#2e333c', margin: '4px 2px' }} />;
}

function itemStyle(danger: boolean, hover: boolean): React.CSSProperties {
  return {
    textAlign: 'left',
    width: '100%',
    background: hover ? (danger ? 'rgba(255, 107, 107, 0.1)' : 'rgba(77, 157, 255, 0.12)') : 'transparent',
    border: 0,
    color: danger ? '#ff6b6b' : '#d6d6d6',
    padding: '7px 8px',
    borderRadius: 5,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function nameText(p: any) {
  const u: string | undefined = p?.username;
  if (!u || /^anonymous\s/i.test(u)) return 'anon';
  return u;
}
