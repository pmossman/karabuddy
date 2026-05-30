'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { Frame, MatchMeta, DecksByUserId } from '@/lib/replayDecoder';
import { cardImageUrl } from '@/lib/cardImage';
import { getOrCreateInstallToken, getOrCreateAuthorName } from '@/lib/installToken';
import { matchChips } from '@/lib/matchMetadata';
import { canDeleteTag, canEditTag, canMutateReplay, type AuthContext } from '@/lib/replayPermissions';
import { ResultBadge } from './ResultBadge';
import { Popover } from '@/app/_components/Popover';
import { DecksModal } from './DecksModal';
import { ShareWithTeam } from './ShareWithTeam';
import { MentionInput, MentionedComment, type MentionData } from './MentionInput';
import { EditableTitle } from './EditableTitle';
// B71: shared scope-derivation — same module the extension copies, so the
// web comment form and the in-game bubble narrow audiences identically.
import { scopeFromMentions, scopeLabel } from '@/lib/commentScope';
import { LabelsRow } from './LabelsRow';

interface ReplayRow {
  slug: string;
  players: any;
  durationMs: number;
  actionCount: number;
  // Ownership + share fields. userId/ownerToken drive both B6 (share /
  // visibility toggle) and B7 (replay-owner can delete other people's tags).
  userId: string | null;
  ownerToken: string;
  visibility: string;
  // B53: optional user-set display name + labels. Both null on replays
  // never edited.
  displayName?: string | null;
  labels?: string[] | null;
  winners?: string[] | null;
}

interface TagRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  userId?: string | null;
  authorToken: string;
  authorName: string;
  comment: string;
  createdAt: string;
  // B71: team slugs this tag is visible to (empty/absent = personal).
  // Returned by GET /tags so the viewer can show + edit each tag's audience.
  scope?: string[];
}

type StepMode = 'action' | 'frame';

interface Props {
  replay: ReplayRow;
  frames: Frame[] | null;
  currentIndex: number;
  // B11: most recent frame transition. Null on initial mount; otherwise
  // `{from, to}` describes the last `setCurrentIndex` call. Forward
  // transitions (to > from) tell FrameLog to highlight the whole frame
  // range so action-mode jumps don't black out intermediate messages.
  lastTransition: { from: number; to: number } | null;
  onStep: (dir: 1 | -1) => void;
  onJump: (i: number) => void;
  // B13: parent owns the prev/next-tag jump so the ReplayViewer's keydown
  // handler can wire `[` / `]` to the same logic these buttons use.
  onJumpToAdjacentTag: (dir: 1 | -1) => void;
  tags: TagRow[];
  setTags: React.Dispatch<React.SetStateAction<TagRow[]>>;
  playerUsernames: Set<string>;
  mode: StepMode;
  setMode: (m: StepMode) => void;
  messagesByFrame: any[][] | null;
  // B44/B46: mobile drawer state is owned by ReplayViewer so the gameboard
  // overlay (frame-nav chevrons) can shift in response. TagSidebar reads to
  // render its mobile chrome (open/closed transforms, floating opener pill,
  // backdrop), writes via setDrawerOpen on dismiss/open.
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  isMobile: boolean;
  // B66: when EITHER mobileLandscape or mobilePortrait is true, the
  // matchup header + decks button render in the separate MatchupPanel
  // instead of inside this drawer, and the step toggle moves to a fixed
  // overlay. mobilePortrait additionally re-anchors this drawer to the
  // BOTTOM edge (slides up) so the gameboard stays visible above.
  mobileLandscape: boolean;
  mobilePortrait: boolean;
  // B66b: sidebar width lifted up to ReplayViewer so FrameNavOverlay
  // (a sibling) can track it for the right-chevron offset.
  sidebarWidth: number;
  setSidebarWidth: React.Dispatch<React.SetStateAction<number>>;
  // B42: deck snapshots + match metadata captured by the recorder. Null
  // for older replays uploaded before B42 landed.
  matchMeta: MatchMeta | null;
  decks: DecksByUserId | null;
  localPlayerId: string | null;
  // B71: teams the comment author can scope a tag to here = teams they're
  // in that this replay is shared with (audience ⊆ shares). Drives the
  // scope chip; empty / single → no chip (nothing to narrow).
  armedTeams: { slug: string; name: string }[];
}

// B42 chip labels live in lib/matchMetadata.ts — single source of truth
// shared with ReplayCard, ReplayFilters, MobileLandscapePanels, and the
// per-player deck page.

const TAG_PLAYER = '#6bd968';
const TAG_REVIEWER = '#e0c64a';

const tagColor = (authorName: string, players: Set<string>) =>
  players.has(authorName) ? TAG_PLAYER : TAG_REVIEWER;

// B12: drag-to-resize sidebar — values mirror the chrome extension's panel
// (see ~/code/karabuddy/extension/replays/05-footer.js), adapted to React
// state. Width persists across reloads via localStorage and clamps to a
// readable min plus half-viewport max so the gameboard always stays visible.
const SIDEBAR_WIDTH_MIN = 280;
const SIDEBAR_WIDTH_DEFAULT = 360;
const SIDEBAR_WIDTH_STORAGE_KEY = 'karabuddy:viewerSidebarWidth';

const clampSidebarWidth = (w: number) =>
  Math.max(SIDEBAR_WIDTH_MIN, Math.min(window.innerWidth * 0.5, w));

const loadStoredSidebarWidth = (): number => {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return SIDEBAR_WIDTH_DEFAULT;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : SIDEBAR_WIDTH_DEFAULT;
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
};

export function TagSidebar({ replay, frames, currentIndex, lastTransition, onStep, onJump, onJumpToAdjacentTag, tags, setTags, playerUsernames, mode, setMode, messagesByFrame, drawerOpen, setDrawerOpen, isMobile, mobileLandscape, mobilePortrait, sidebarWidth, setSidebarWidth, matchMeta, decks, localPlayerId, armedTeams }: Props) {
  const { data: session } = useSession();
  const [installToken, setInstallToken] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [decksOpen, setDecksOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // B55c: structured mentions for the in-progress tag draft. Cleared on
  // submit/cancel. Userid + teamSlug picked from the autocomplete popover.
  const [draftMentions, setDraftMentions] = useState<{ userIds: string[]; teamSlugs: string[] }>({ userIds: [], teamSlugs: [] });
  // Mention autocomplete data — loaded lazily when the user opens the
  // tag form for the first time. Null = not loaded yet / not signed in.
  const [mentionData, setMentionData] = useState<MentionData | null>(null);
  const mentionLoadedRef = useRef(false);
  // B71: per-comment scope. null = follow the mentions (the default rule);
  // a string[] = a manual override the user set via the chip. Reset after
  // each submit. `scopeExpanded` toggles the chip's checkbox panel.
  const [scopeOverride, setScopeOverride] = useState<string[] | null>(null);
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const [visibility, setVisibility] = useState(replay.visibility);
  const [copied, setCopied] = useState(false);
  const [visBusy, setVisBusy] = useState(false);
  // B12: sidebar width starts at the default during SSR/first paint, then
  // hydrates from localStorage in an effect to avoid hydration mismatch.
  // B66b: sidebarWidth state moved up to ReplayViewer; props are passed
  // in. This local placeholder kept only to silence the unused-default
  // constant — actual state is the props above.
  const [resizeHandleHover, setResizeHandleHover] = useState(false);
  const [resizeHandleActive, setResizeHandleActive] = useState(false);
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const sessionUserId: string | null = ((session?.user as any)?.id as string | undefined) || null;

  // B44/B46: isMobile + drawerOpen are now controlled by ReplayViewer so
  // sibling components (e.g. the gameboard frame-nav overlay) can react to
  // the same state. See ReplayViewer for the parent useMediaQuery hook.

  useEffect(() => {
    setInstallToken(getOrCreateInstallToken());
    setAuthorName(getOrCreateAuthorName());
    setSidebarWidth(clampSidebarWidth(loadStoredSidebarWidth()));
  }, []);

  // Bug surfaced live: signed-in tags were attributed to the extension's
  // anon-XXX handle (the localStorage default), not the user's account
  // display name. Override authorName once the session resolves so the
  // "Tagging as X" label + persisted authorName both reflect the user's
  // identity. karabastUsername is the most accurate handle (matches what
  // shows on karabast.net); fall back to the OAuth display name.
  useEffect(() => {
    const su = session?.user as any;
    const preferred: string | undefined = su?.karabastUsername || su?.name;
    if (preferred) setAuthorName(preferred);
  }, [session]);

  // B12: install global mousemove/mouseup listeners while a drag is in
  // progress. Ported from the extension's onDragStart loop — using a ref for
  // dragState so React state updates don't recreate the listeners.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      // B66b: sidebar is right-anchored — drag LEFT (negative deltaX)
      // widens it, so invert the sign.
      const next = clampSidebarWidth(s.startW - (e.clientX - s.startX));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizeHandleActive(false);
      try {
        // Use the latest width directly off the DOM-style; React state is
        // already in sync because setSidebarWidth ran on every mousemove.
        // Persist by reading state via a functional setState so we capture
        // the most recent value without depending on closures.
        setSidebarWidth((w) => {
          try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(w)); } catch {}
          return w;
        });
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onResizeHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startW: sidebarWidth };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
    setResizeHandleActive(true);
  };

  // B66d: shared predicate module so server enforcement + client UI
  // gating can't drift. Drives both B6 (share / visibility) and B7
  // (replay-owner tag delete).
  const authCtx: AuthContext = { sessionUserId, installToken: installToken || null };
  const isOwner = canMutateReplay(
    { userId: replay.userId, ownerToken: replay.ownerToken },
    authCtx,
  );

  const copyLink = async () => {
    const url = `${window.location.origin}/r/${replay.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const toggleVisibility = async () => {
    if (visBusy) return;
    const next = visibility === 'public' ? 'unlisted' : 'public';
    // Optimistic — revert on failure.
    const prev = visibility;
    setVisibility(next);
    setVisBusy(true);
    try {
      const res = await fetch(`/api/replays/${replay.slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ visibility: next }),
      });
      const body = await res.json();
      if (!body.ok) {
        setVisibility(prev);
        alert(`Failed to update visibility: ${body.error || 'unknown'}`);
      }
    } catch (err) {
      setVisibility(prev);
      const msg = err instanceof Error ? err.message : 'network error';
      alert(`Failed to update visibility: ${msg}`);
    } finally {
      setVisBusy(false);
    }
  };

  const playersArr = (replay.players as any[]) || [];
  const [p1, p2] = playersArr;

  const tagsByFrame = useMemo(() => {
    const m = new Map<number, TagRow[]>();
    for (const t of tags) {
      const list = m.get(t.frameIndex) || [];
      list.push(t);
      m.set(t.frameIndex, list);
    }
    return m;
  }, [tags]);

  // B71: scope-chip derivation. armedSlugs = the teams I can scope to here
  // (replay shares ∩ my teams). memberTeams maps a mentioned user → their
  // teams so the SHARED scopeFromMentions rule can narrow live. The chip
  // only appears when there's an actual choice (2+ armed teams).
  const armedSlugs = useMemo(() => armedTeams.map((t) => t.slug), [armedTeams]);
  const teamNames = useMemo(
    () => Object.fromEntries(armedTeams.map((t) => [t.slug, t.name])) as Record<string, string>,
    [armedTeams],
  );
  const memberTeams = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const m of mentionData?.members ?? []) map[m.userId] = m.teamSlugs;
    return map;
  }, [mentionData]);
  const mentionDrivenScope = useMemo(
    () => scopeFromMentions({ armedTeams: armedSlugs, mentionedUserIds: draftMentions.userIds, memberTeams }),
    [armedSlugs, draftMentions.userIds, memberTeams],
  );
  // Manual override (chip checkboxes) wins until reset; else follow mentions.
  const effectiveScope = scopeOverride ?? mentionDrivenScope;
  // Show whenever the replay is shared with ≥1 of your teams: confirms the
  // audience, and the expanded checkboxes let you narrow (2+) or go personal.
  const showScopeChip = armedSlugs.length >= 1;

  const resetScope = () => { setScopeOverride(null); setScopeExpanded(false); };

  const submitTag = async () => {
    if (!installToken || !frames) return;
    const hasMentions = draftMentions.userIds.length > 0 || draftMentions.teamSlugs.length > 0;
    const res = await fetch(`/api/replays/${replay.slug}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installToken,
        authorName,
        frameIndex: currentIndex,
        comment: draft,
        // B55c: structured mentions selected via autocomplete. Only sent
        // when non-empty so old API consumers stay backward-compatible.
        ...(hasMentions ? { mentions: draftMentions } : {}),
        // B71: only send teamSlugs when the chip is in play (replay shared
        // with 2+ of my teams). With 0/1 armed teams the server default
        // (all shares) is already correct, so we stay backward-compatible.
        ...(showScopeChip ? { teamSlugs: effectiveScope } : {}),
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to add tag: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => [
      ...prev,
      {
        id: body.id,
        replaySlug: replay.slug,
        frameIndex: currentIndex,
        authorToken: installToken,
        authorName,
        comment: draft,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft('');
    setDraftMentions({ userIds: [], teamSlugs: [] });
    resetScope();
    setFormOpen(false);
  };

  // Lazy-load the mention autocomplete data when the user first opens
  // the tag form. Fails silently if not signed in or no teams — popover
  // just doesn't appear.
  useEffect(() => {
    if (!formOpen || mentionLoadedRef.current) return;
    mentionLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/me/teams-mention-data');
        const body = await res.json();
        if (body.ok && (body.teams?.length || body.members?.length)) {
          setMentionData({ teams: body.teams || [], members: body.members || [] });
        }
      } catch {}
    })();
  }, [formOpen]);

  const deleteTag = async (id: string) => {
    if (!confirm('Delete this tag?')) return;
    const res = await fetch(`/api/replays/${replay.slug}/tags/${id}`, {
      method: 'DELETE',
      headers: { 'X-Install-Token': installToken },
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to delete: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
  };

  // B71-followup: editing a tag can also change its team scope. teamSlugs
  // undefined → comment-only edit (scope untouched); an array → re-scope
  // (server clamps to shares ∩ the author's memberships and returns it).
  const updateComment = async (id: string, comment: string, teamSlugs?: string[]) => {
    const res = await fetch(`/api/replays/${replay.slug}/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
      body: JSON.stringify({ comment, ...(teamSlugs !== undefined ? { teamSlugs } : {}) }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to update: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, comment, ...(body.scope ? { scope: body.scope } : {}) } : t)));
  };

  const tagsAtCurrent = tagsByFrame.get(currentIndex) || [];

  // B44/B66: mobile drawer styling overrides desktop's flex-child positioning.
  // The aside takes itself out of normal flow with position:fixed so the
  // gameboard's flex container reclaims the width; the drawer slides in/out
  // via transform, which animates cheaper than width. Landscape anchors to
  // the RIGHT edge; portrait anchors to the BOTTOM (slides up) so the
  // gameboard remains visible above between the top MatchupPanel and this
  // drawer.
  const mobileWidth = 'min(380px, 100vw)';
  const asideStyle: React.CSSProperties = mobilePortrait
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '60vh',
        zIndex: 80,
        transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: drawerOpen ? '0 -8px 24px rgba(0,0,0,0.45)' : 'none',
        background: 'rgba(17, 20, 26, 0.97)',
        borderTop: '1px solid #2e333c',
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        color: '#e6e6e6',
        font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : isMobile
    ? {
        // Mobile landscape: right-anchored overlay slide-in. Doesn't
        // displace the gameboard — slides over the right edge instead.
        position: 'fixed',
        top: 'var(--kb-header-h, 0px)',
        right: 0,
        bottom: 0,
        width: mobileWidth,
        zIndex: 80,
        transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: drawerOpen ? '-8px 0 24px rgba(0,0,0,0.45)' : 'none',
        background: 'rgba(17, 20, 26, 0.97)',
        borderLeft: '1px solid #2e333c',
        color: '#e6e6e6',
        font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        // Desktop: flex-child anchored to the RIGHT side of the viewport
        // (gameboard takes the left). Toggling closed unmounts the aside
        // so the gameboard reclaims the width. State (popovers, scroll)
        // resets on reopen — acceptable tradeoff for the simpler model.
        width: sidebarWidth,
        flex: `0 0 ${sidebarWidth}px`,
        background: 'rgba(17, 20, 26, 0.95)',
        borderLeft: '1px solid #2e333c',
        color: '#e6e6e6',
        font: '12px var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      };

  return (
    <>
      {/* B44/B66b: single ☰ toggle — opens AND closes the sidebar so the
          affordance doesn't relocate between states. Shifts horizontally
          past the sidebar/drawer when open so it stays alongside the
          drawer's outer edge (instead of getting buried under the panel).
          Portrait: shifts UP past the bottom drawer instead. */}
      {(() => {
        // Outer edge of the sidebar/drawer when open — the toggle hugs it
        // from outside so its position feels continuous with the drawer.
        const horizontalRight = mobilePortrait
          ? 'max(12px, env(safe-area-inset-right, 12px))'
          : drawerOpen
          ? `calc(${isMobile ? mobileWidth : `${sidebarWidth}px`} + 12px)`
          : 'max(12px, env(safe-area-inset-right, 12px))';
        const bottomOffset = mobilePortrait && drawerOpen
          ? 'calc(60vh + 12px)'
          : 'max(12px, env(safe-area-inset-bottom, 12px))';
        return (
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-label={drawerOpen ? 'Close tags panel' : 'Open tags panel'}
            title={drawerOpen ? 'Close tags' : 'Open tags'}
            style={{
              position: 'fixed',
              bottom: bottomOffset,
              right: horizontalRight,
              zIndex: 90,
              width: 38,
              height: 38,
              background: drawerOpen ? 'rgba(74, 124, 255, 0.32)' : 'rgba(36, 48, 68, 0.85)',
              color: '#d6e7ff',
              border: '1px solid rgba(74, 124, 255, 0.4)',
              borderRadius: '50%',
              padding: 0,
              fontSize: 16,
              lineHeight: 1,
              cursor: 'pointer',
              fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(6px)',
              transition: 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), bottom 220ms cubic-bezier(0.4, 0, 0.2, 1), background 160ms ease',
            }}
          >
            ☰
          </button>
        );
      })()}

      {/* B44 mobile: dimmed backdrop — fades in with the drawer, dismisses
          on tap. Only rendered while the drawer is open AND we're on mobile;
          desktop never gets a backdrop because the sidebar is docked, not
          floating. */}
      {isMobile && drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
          style={{
            position: 'fixed',
            top: 'var(--kb-header-h, 0px)',
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 75,
            background: 'rgba(0, 0, 0, 0.45)',
            animation: 'kb-fade-in 220ms ease',
          }}
        />
      )}

      {/* Keyframes scoped inline so this file remains self-contained — only
          referenced by the backdrop above. */}
      <style>{`@keyframes kb-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* B66b: desktop unmounts the aside when closed so the gameboard
          flex-sibling reclaims width. Mobile keeps it mounted and slides
          out via transform so internal state (scroll, popovers) survives. */}
      {(isMobile || drawerOpen) && (
      <aside data-testid="tags-drawer" style={asideStyle}>
      {/* B10: compact header — leader+base per player, share collapsed
          into a top-right popover. B12: usernames now wrap to their own
          line beneath the thumbs, so the row aligns to the top of the
          thumbs to keep VS visually centered against the cards (not the
          taller two-line player column). B66: hidden on ANY mobile —
          the MatchupPanel (left on landscape, top on portrait) takes
          over this content. */}
      {!isMobile && (
      <header style={{ padding: '10px 14px 10px 16px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        {matchChips(matchMeta).length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {matchChips(matchMeta).map((label) => (
              <span
                key={`m-${label}`}
                style={{
                  background: 'rgba(74, 124, 255, 0.12)',
                  border: '1px solid rgba(74, 124, 255, 0.3)',
                  color: '#a0c4ff',
                  borderRadius: 999,
                  padding: '1px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {/* B66b/B66c: replay title — inline-editable. Falls back to the
            same "username vs username" string the browser uses if no
            display name has been set. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <EditableTitle
            replaySlug={replay.slug}
            installToken={installToken}
            initialDisplayName={replay.displayName ?? null}
            defaultText={defaultTitleFor(replay)}
            canEdit={isOwner}
          />
        </div>
        {/* B66c: labels as their own pill row + plus button, separate
            from the title affordance. Always render the row so the +
            button is discoverable even with zero labels. */}
        {(isOwner || (Array.isArray(replay.labels) && replay.labels.length > 0)) && (
          <LabelsRow
            replaySlug={replay.slug}
            installToken={installToken}
            initialLabels={Array.isArray(replay.labels) ? replay.labels : []}
            canEdit={isOwner}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        {/* B66b: × close button removed — the floating ☰ toggle outside
            the sidebar handles both open + close so the affordance stays
            in one place. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flex: 1, minWidth: 0 }}>
          <MatchupRow player={p1} winners={replay.winners} />
          {/* Sits vertically aligned with the 32px-tall thumb row above the
              username — pad-top half the thumb height minus half text. */}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#6c7588', flex: '0 0 auto', paddingTop: 11 }}>VS</span>
          <MatchupRow player={p2} winners={replay.winners} />
        </div>
        <Popover
          align="right"
          label="Share replay"
          trigger={(open, toggle) => (
            <IconBtn onClick={toggle} title="Share" active={open}>
              <ShareIcon />
            </IconBtn>
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
            <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Share</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <FooterBtn onClick={copyLink}>
                {copied ? 'Copied!' : 'Copy link'}
              </FooterBtn>
              {isOwner && (
                <VisibilityPill
                  visibility={visibility}
                  busy={visBusy}
                  onClick={toggleVisibility}
                />
              )}
            </div>
            {isOwner && (
              <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
                {visibility === 'public'
                  ? 'Listed publicly on /replays.'
                  : 'Anyone with the link can view.'}
              </div>
            )}
            {isOwner && (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid #2e333c' }}>
                <ShareWithTeam replaySlug={replay.slug} installToken={installToken} />
              </div>
            )}
            {/* B66b: EditReplayMeta moved out of this popover into the
                sidebar title row above for first-class discoverability. */}
          </div>
        </Popover>
        </div>
      </header>
      )}

      {/* B48/B66/B66b: frame-counter row inside the drawer on every
          viewport. Step-by toggle and prev/next arrows moved out to the
          gameboard overlays (StepModeOverlay + FrameNavOverlay). */}
      <section style={{ padding: '8px 14px 10px 16px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: '#d6d6d6', fontWeight: 600 }}>
          {frames ? `Frame ${currentIndex + 1} / ${frames.length}` : '…'}
        </span>
      </section>

      {/* B66b dead-store: previous desktop-only nav/step row got replaced
          by the floating overlays. Block kept-but-gated so the imports
          (Popover/IconBtn/GearIcon/ModeSegmented) above this file's
          export still resolve until a cleanup pass strips them. */}
      {false && (
        <section>
          <div>
            <Popover
              align="right"
              label="Step settings"
              trigger={(open, toggle) => (
                <IconBtn onClick={toggle} title="Step settings" active={open}>
                  <GearIcon />
                </IconBtn>
              )}
            >
              <div>
                <ModeSegmented mode={mode} setMode={setMode} />
              </div>
            </Popover>
          </div>
        </section>
      )}

      <FrameLog
        messagesByFrame={messagesByFrame}
        currentIndex={currentIndex}
        lastTransition={lastTransition}
        frames={frames}
      />

      <section style={{ padding: '14px 22px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* B34: "+ Tag this frame" gets its own line (full-width button) so
            it's the primary action above the tag list. Prev/Next tag nav
            moved out of here, into its own section below the tag display
            area (the natural place to skim "what's next?" after reviewing
            the current frame's tags). [ / ] shortcuts in ReplayViewer
            still invoke onJumpToAdjacentTag. */}
        <FooterBtn variant="outline" onClick={() => setFormOpen((v) => !v)} fullWidth>
          + Tag this frame
        </FooterBtn>
        {formOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(74, 124, 255, 0.08)', border: '1px solid rgba(74, 124, 255, 0.3)', borderRadius: 6 }}>
            <div style={{ fontSize: 11, color: '#a0a8b8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: tagColor(authorName, playerUsernames) }} />
              <span>Tagging as {authorName}</span>
            </div>
            <MentionInput
              value={draft}
              onChange={setDraft}
              onMention={(kind, id) => {
                setDraftMentions((prev) => {
                  if (kind === 'user') {
                    if (prev.userIds.includes(id)) return prev;
                    return { ...prev, userIds: [...prev.userIds, id] };
                  }
                  if (prev.teamSlugs.includes(id)) return prev;
                  return { ...prev, teamSlugs: [...prev.teamSlugs, id] };
                });
              }}
              mentionData={mentionData}
              placeholder="Your note about this moment… @mention to notify"
              rows={2}
              onSubmit={submitTag}
              onCancel={() => setFormOpen(false)}
              textareaStyle={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#11141a',
                color: '#e6e6e6',
                border: '1px solid #2e333c',
                borderRadius: 4,
                padding: '6px 8px',
                font: '12px var(--font-barlow), -apple-system, sans-serif',
                resize: 'vertical',
                outline: 'none',
                minHeight: 50,
              }}
            />
            {showScopeChip && (
              <ScopeChip
                armedTeams={armedTeams}
                effectiveScope={effectiveScope}
                teamNames={teamNames}
                expanded={scopeExpanded}
                onToggleExpand={() => setScopeExpanded((v) => !v)}
                onToggleTeam={(slug) => {
                  // First manual edit seeds the override from the current
                  // (mention-driven) scope, then toggles this team. Further
                  // mention edits are overridden until the tag is submitted.
                  setScopeOverride((prev) => {
                    const base = prev ?? effectiveScope;
                    const set = new Set(base);
                    if (set.has(slug)) set.delete(slug); else set.add(slug);
                    // Keep armed order for stability.
                    return armedSlugs.filter((s) => set.has(s));
                  });
                }}
                onPersonal={() => setScopeOverride([])}
              />
            )}
            <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
              <FooterBtn variant="ghost" onClick={() => { resetScope(); setFormOpen(false); }}>Cancel</FooterBtn>
              <FooterBtn onClick={submitTag}>Save tag</FooterBtn>
            </div>
          </div>
        )}
      </section>

      <section style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', padding: '14px 22px', borderTop: '1px solid #2e333c' }}>
        {tagsAtCurrent.length > 0 && (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This frame</div>
            {tagsAtCurrent.map((t) => {
              const canEdit = canEditTag(t, authCtx);
              const canDelete = canDeleteTag(t, { userId: replay.userId, ownerToken: replay.ownerToken }, authCtx);
              const c = tagColor(t.authorName, playerUsernames);
              return (
                <TagRowView
                  key={t.id}
                  tag={t}
                  color={c}
                  isCurrent={true}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  armedTeams={armedTeams}
                  onJumpTo={() => {}}
                  onDelete={() => deleteTag(t.id)}
                  onUpdate={(comment, teamSlugs) => updateComment(t.id, comment, teamSlugs)}
                />
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>All tags ({tags.length})</div>
        {tags.length === 0 ? (
          <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>No tags yet. Click &quot;+ Tag this frame&quot; to add one.</div>
        ) : (
          // B3 + B7: filter out current-frame tags (already shown in the
          // callout above), then render the rest with B7's per-tag canEdit
          // / canDelete computation so replay owners can delete others'
          // comments but only authors can edit text.
          (() => {
            const otherTags = tags.filter((t) => t.frameIndex !== currentIndex);
            if (otherTags.length === 0) {
              return (
                <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>No other tags on this replay.</div>
              );
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...otherTags].sort((a, b) => a.frameIndex - b.frameIndex).map((t) => {
                  const canEdit = canEditTag(t, authCtx);
                  const canDelete = canDeleteTag(t, { userId: replay.userId, ownerToken: replay.ownerToken }, authCtx);
                  const c = tagColor(t.authorName, playerUsernames);
                  return (
                    <TagRowView
                      key={t.id}
                      tag={t}
                      color={c}
                      isCurrent={false}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      armedTeams={armedTeams}
                      onJumpTo={() => onJump(t.frameIndex)}
                      onDelete={() => deleteTag(t.id)}
                      onUpdate={(comment, teamSlugs) => updateComment(t.id, comment, teamSlugs)}
                    />
                  );
                })}
              </div>
            );
          })()
        )}
      </section>

      {/* B42 / B64 / B66: deck snapshot launcher. Hidden on ANY mobile
          — the MatchupPanel (left/top) owns the View-decks button so
          the drawer stays slim and dedicated to discussion. */}
      {decks && Object.keys(decks).length > 0 && !isMobile && (
        <section style={{ borderTop: '1px solid #2e333c', padding: '10px 22px', flex: '0 0 auto' }}>
          <button
            type="button"
            onClick={() => setDecksOpen(true)}
            style={{
              background: 'transparent',
              border: '1px solid #2e333c',
              borderRadius: 4,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: '#a0c4ff',
              cursor: 'pointer',
              fontFamily: 'inherit',
              width: '100%',
              textAlign: 'left',
            }}
          >
            View decks →
          </button>
        </section>
      )}
      {decks && Object.keys(decks).length > 0 && !isMobile && (
        <DecksModal
          open={decksOpen}
          onClose={() => setDecksOpen(false)}
          decks={decks}
          localPlayerId={localPlayerId}
          replaySlug={replay.slug}
          frames={frames}
        />
      )}

      {/* B34: prev/next tag nav lives below the tag display, not above —
          natural "after you've read the current frame's tags, jump to the
          next one" flow. Hidden when there are no tags to jump to. */}
      {tags.length > 0 && (
        <section style={{ padding: '10px 22px', borderTop: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', gap: 6, justifyContent: 'space-between' }}>
          <FooterBtn onClick={() => onJumpToAdjacentTag(-1)} variant="ghost" title="Previous tag ([)">‹ Prev tag</FooterBtn>
          <FooterBtn onClick={() => onJumpToAdjacentTag(1)} variant="ghost" title="Next tag (])">Next tag ›</FooterBtn>
        </section>
      )}

      {/* B12: drag handle pinned to the sidebar's LEFT edge (B66b moved
          the sidebar to the right side of the viewport — the handle has
          to live on its leading inward edge so drag-left widens it). */}
      {!isMobile && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={onResizeHandleMouseDown}
          onMouseEnter={() => setResizeHandleHover(true)}
          onMouseLeave={() => setResizeHandleHover(false)}
          onDoubleClick={() => {
            const next = SIDEBAR_WIDTH_DEFAULT;
            setSidebarWidth(next);
            try { localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next)); } catch {}
          }}
          title="Drag to resize (double-click to reset)"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 6,
            height: '100%',
            cursor: 'ew-resize',
            userSelect: 'none',
            background: resizeHandleActive
              ? 'rgba(74, 124, 255, 0.45)'
              : resizeHandleHover
              ? 'rgba(74, 124, 255, 0.18)'
              : 'transparent',
            transition: 'background 120ms ease',
            zIndex: 10,
          }}
        />
      )}
    </aside>
    )}
    </>
  );
}

// Per-frame "what happened" log. Renders cumulative messages from frame 0
// up through `currentIndex`, with the most recent action's batch at full
// opacity and prior frames dimmed for historical context — mirrors the
// chrome extension's logBody (see ~/code/karabuddy/extension/replays/05-footer.js).
//
// B11: highlight set is driven by `lastTransition`, not just `currentIndex`.
// Forward jumps (e.g. action-mode 5 -> 12) light up messages on frames
// 6..12 so the player can read everything the step covered. Backward jumps
// and the initial mount fall back to highlighting only the current frame.
//
// Player names inside messages are color-coded: first player in the frame-0
// players map is blue, second is red. Matches setConnectedPlayer in
// ReplayViewer (which picks the first player as the viewer perspective).
const PLAYER_COLOR_USER = '#5da9ff';
const PLAYER_COLOR_OPPONENT = '#ff6b6b';

function FrameLog({
  messagesByFrame,
  currentIndex,
  lastTransition,
  frames,
}: {
  messagesByFrame: any[][] | null;
  currentIndex: number;
  lastTransition: { from: number; to: number } | null;
  frames: Frame[] | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLDivElement>(null);

  const playerIdToColor = useMemo(() => {
    const m = new Map<string, string>();
    const players = frames?.[0]?.state?.players;
    if (!players) return m;
    const keys = Object.keys(players);
    if (keys[0]) m.set(keys[0], PLAYER_COLOR_USER);
    if (keys[1]) m.set(keys[1], PLAYER_COLOR_OPPONENT);
    return m;
  }, [frames]);

  // Compute the range of frames whose messages we should highlight.
  // Forward step (from→to where to>from): highlight frames (from+1..to)
  //   — "what just happened" to land here.
  // Backward step OR initial load: just highlight the current frame.
  const { highlightFrames, isForward } = useMemo(() => {
    if (lastTransition && lastTransition.to > lastTransition.from && lastTransition.to === currentIndex) {
      const lo = lastTransition.from;
      const hi = lastTransition.to;
      const range: number[] = [];
      for (let i = lo + 1; i <= hi; i++) range.push(i);
      return { highlightFrames: range, isForward: true };
    }
    return { highlightFrames: [currentIndex], isForward: false };
  }, [lastTransition, currentIndex]);

  const headerText = isForward && highlightFrames.length > 1
    ? `What happened (over ${highlightFrames.length} frames)`
    : 'What happened at this frame';

  const entries = useMemo(() => {
    if (!messagesByFrame) return [];
    const highlightSet = new Set(highlightFrames);
    const out: { frame: number; msg: any; highlighted: boolean }[] = [];
    const upTo = Math.min(currentIndex, messagesByFrame.length - 1);
    for (let i = 0; i <= upTo; i++) {
      const fmsgs = messagesByFrame[i] || [];
      for (const msg of fmsgs) {
        out.push({ frame: i, msg, highlighted: highlightSet.has(i) });
      }
    }
    return out;
  }, [messagesByFrame, currentIndex, highlightFrames]);

  // Scroll the first highlighted row into view whenever the current frame
  // (or the log contents) change. Falls back to scrolling to the bottom
  // when the current frame has no messages of its own.
  useEffect(() => {
    if (currentRowRef.current) {
      currentRowRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <section
      style={{
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid #2e333c',
      }}
    >
      <div
        style={{
          padding: '12px 22px 6px',
          fontSize: 11,
          color: '#6c7588',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          flex: '0 0 auto',
        }}
      >
        {headerText}
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: '1 1 0',
          minHeight: 0,
          overflowY: 'auto',
          padding: '0 22px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 13,
          lineHeight: 1.4,
        }}
      >
        {entries.length === 0 ? (
          <div style={{ color: '#6c7588', fontStyle: 'italic' }}>(no log entries yet)</div>
        ) : (
          entries.map((entry, idx) => {
            const isFirstHighlighted =
              entry.highlighted && (idx === 0 || !entries[idx - 1].highlighted);
            return (
              <div
                key={`${entry.frame}-${idx}`}
                ref={isFirstHighlighted ? currentRowRef : null}
                style={{ opacity: entry.highlighted ? 1 : 0.45, transition: 'opacity 120ms ease' }}
              >
                {renderMessage(entry.msg, playerIdToColor)}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function renderMessage(msg: any, playerColor: Map<string, string>): React.ReactNode {
  if (!msg) return null;
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg.message)) return null;
  return msg.message.map((part: any, i: number) => {
    if (typeof part === 'string') return <React.Fragment key={i}>{part}</React.Fragment>;
    const name = part?.name ?? '';
    if (!name) return null;
    const color = part?.type === 'player' ? playerColor.get(part.id) : null;
    if (color) {
      return (
        <span key={i} style={{ color, fontWeight: 600 }}>
          {name}
        </span>
      );
    }
    return <React.Fragment key={i}>{name}</React.Fragment>;
  });
}

// B66c: default replay title — mirrors what the replay browser shows
// ("<username> vs <username>") so the title row never reads as blank
// when no custom displayName is set.
function defaultTitleFor(replay: { players: any }): string {
  const players = Array.isArray(replay.players) ? replay.players : [];
  const [p1, p2] = players;
  const name = (p: any) => {
    const u: string | undefined = p?.username;
    if (!u || /^anonymous\s/i.test(u)) return 'anon';
    return u;
  };
  if (!p1 && !p2) return 'Replay';
  return `${name(p1)} vs ${name(p2)}`;
}

// B10: compact variant — leader and base side-by-side at a smaller thumb
// size. B12: username moved onto its own line below the thumbs, centered,
// so longer handles (e.g. `anonymous 95d0c6`) render in full at the default
// 360px sidebar width without ellipsis. Replaces the old two-row stacked
// Matchup which dominated the sidebar header.
function MatchupRow({ player, winners }: { player: any; winners?: string[] | null }) {
  if (!player) return <div style={{ flex: 1, minWidth: 0 }} />;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        flex: 1,
        minWidth: 0,
      }}
      title={`${player.leader?.name || '?'} / ${player.base?.name || '?'} — ${player.username || 'anon'}`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <CardImg src={cardImageUrl(player.leader, true)} alt={player.leader?.name} />
        <CardImg src={cardImageUrl(player.base, false)} alt={player.base?.name} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: '100%' }}>
        <ResultBadge playerId={player.id} winners={winners} />
        <span
          style={{
            fontSize: 11,
            color: '#a0a8b8',
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {player.username || 'anon'}
        </span>
      </div>
    </div>
  );
}

function CardImg({ src, alt }: { src: string | null; alt?: string }) {
  if (!src) {
    return (
      <div style={{ width: 32, height: 32, borderRadius: 3, background: '#0a0c10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6c7588', fontSize: 8, textAlign: 'center', padding: 2, boxSizing: 'border-box', flex: '0 0 auto' }}>
        {(alt || '—').slice(0, 4)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 3, background: '#0a0c10', flex: '0 0 auto' }}
    />
  );
}

function IconBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        padding: 0,
        background: active ? 'rgba(74, 124, 255, 0.18)' : 'transparent',
        border: `1px solid ${active ? '#4a7cff' : '#3a3e46'}`,
        borderRadius: 4,
        color: active ? '#5da9ff' : '#a0a8b8',
        cursor: 'pointer',
        flex: '0 0 auto',
      }}
    >
      {children}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ModeSegmented({ mode, setMode, title }: { mode: StepMode; setMode: (m: StepMode) => void; title?: string }) {
  const seg: React.CSSProperties = {
    background: 'transparent',
    color: '#a0a8b8',
    border: 0,
    padding: '0 10px',
    font: '600 11px var(--font-barlow), sans-serif',
    cursor: 'pointer',
    lineHeight: '22px',
  };
  const sel: React.CSSProperties = { background: '#4a7cff', color: 'white' };
  return (
    <div title={title} style={{ display: 'inline-flex', alignSelf: 'flex-start', border: '1px solid #4a4e56', borderRadius: 4, overflow: 'hidden', height: 22 }}>
      <button type="button" style={{ ...seg, ...(mode === 'action' ? sel : {}) }} onClick={() => setMode('action')}>Action</button>
      <button type="button" style={{ ...seg, ...(mode === 'frame' ? sel : {}) }} onClick={() => setMode('frame')}>Frame</button>
    </div>
  );
}

// B71: collapsed scope chip for the comment form. Shows a live readout of
// who'll see the comment; click to expand the per-team checkboxes + a
// "Just me" (personal) option. Only rendered when 2+ teams are armed.
function ScopeChip({
  armedTeams,
  effectiveScope,
  teamNames,
  expanded,
  onToggleExpand,
  onToggleTeam,
  onPersonal,
}: {
  armedTeams: { slug: string; name: string }[];
  effectiveScope: string[];
  teamNames: Record<string, string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleTeam: (slug: string) => void;
  onPersonal: () => void;
}) {
  const armedSlugs = armedTeams.map((t) => t.slug);
  const label = scopeLabel(effectiveScope, armedSlugs, teamNames);
  const isPersonal = effectiveScope.length === 0;
  return (
    <div data-testid="scope-chip" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        data-testid="scope-chip-toggle"
        onClick={onToggleExpand}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(74, 124, 255, 0.08)',
          border: '1px solid rgba(74, 124, 255, 0.3)',
          color: '#a0c4ff',
          borderRadius: 999,
          padding: '3px 10px',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span style={{ color: '#6c7588' }}>Visible to:</span>
        <span data-testid="scope-chip-label">{label}</span>
        <span style={{ fontSize: 9 }}>{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', background: '#11141a', border: '1px solid #2e333c', borderRadius: 6 }}>
          {armedTeams.map((t) => {
            const checked = effectiveScope.includes(t.slug);
            return (
              <label key={t.slug} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e6e6e6', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => onToggleTeam(t.slug)} />
                {t.name}
              </label>
            );
          })}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: isPersonal ? '#e6e6e6' : '#a0a8b8', cursor: 'pointer', borderTop: '1px solid #2e333c', paddingTop: 4, marginTop: 2 }}>
            <input type="radio" checked={isPersonal} onChange={onPersonal} />
            Just me (personal)
          </label>
        </div>
      )}
    </div>
  );
}

function FooterBtn({
  children,
  onClick,
  variant = 'primary',
  alignSelf = false,
  fullWidth = false,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'ghost' | 'outline';
  alignSelf?: boolean;
  fullWidth?: boolean;
  title?: string;
}) {
  const base: React.CSSProperties = {
    border: 0,
    borderRadius: 4,
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'inherit',
    lineHeight: 1.2,
  };
  if (variant === 'ghost') {
    base.background = 'transparent';
    base.border = '1px solid #4a4e56';
    base.color = '#a0a8b8';
  } else if (variant === 'outline') {
    base.background = 'transparent';
    base.border = '1px solid #4a7cff';
    base.color = '#5da9ff';
  } else {
    base.background = '#4a7cff';
    base.color = 'white';
  }
  if (alignSelf) base.alignSelf = 'flex-start';
  if (fullWidth) { base.width = '100%'; base.padding = '8px 10px'; }
  return (
    <button type="button" style={base} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function TagRowView({
  tag,
  color,
  isCurrent,
  canEdit,
  canDelete,
  armedTeams,
  onJumpTo,
  onDelete,
  onUpdate,
}: {
  tag: TagRow;
  color: string;
  isCurrent: boolean;
  // B7: split tag-author affordance into edit vs delete. Replay owners
  // get delete on other people's tags but never edit (don't put words in
  // their mouth).
  canEdit: boolean;
  canDelete: boolean;
  // B71: teams the viewer could scope this tag to (replay shares ∩ their
  // teams). Drives the per-tag "Visible to:" readout + edit chip.
  armedTeams: { slug: string; name: string }[];
  onJumpTo: () => void;
  onDelete: () => void;
  onUpdate: (comment: string, teamSlugs?: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.comment);
  const [editScope, setEditScope] = useState<string[]>(tag.scope ?? []);
  const [scopeExpanded, setScopeExpanded] = useState(false);

  const armedSlugs = armedTeams.map((t) => t.slug);
  const teamNames = Object.fromEntries(armedTeams.map((t) => [t.slug, t.name])) as Record<string, string>;
  const canScope = armedSlugs.length >= 1; // replay shared with ≥1 of my teams

  const beginEdit = () => {
    setDraft(tag.comment);
    setEditScope(tag.scope ?? []);
    setScopeExpanded(false);
    setEditing(true);
  };
  const save = () => {
    onUpdate(draft.trim(), canScope ? editScope : undefined);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(tag.comment);
    setEditScope(tag.scope ?? []);
    setEditing(false);
  };

  return (
    <div
      onClick={() => !editing && onJumpTo()}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 8,
        padding: '6px 8px',
        borderRadius: 4,
        background: isCurrent ? 'rgba(74, 124, 255, 0.12)' : 'rgba(255,255,255,0.025)',
        borderLeft: `3px solid ${color}`,
        opacity: isCurrent ? 1 : 0.45,
        cursor: editing ? 'text' : 'pointer',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#a0a8b8', display: 'flex', gap: 8 }}>
          <span style={{ color, fontWeight: 600 }}>{tag.authorName}</span>
          <span style={{ color: '#4a4e56' }}>·</span>
          <span>frame {tag.frameIndex + 1}</span>
        </div>
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#11141a',
                color: '#e6e6e6',
                border: '1px solid #4a7cff',
                borderRadius: 4,
                padding: '4px 6px',
                font: '12px inherit',
                resize: 'vertical',
                outline: 'none',
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
            />
            {canScope && (
              <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 4 }}>
                <ScopeChip
                  armedTeams={armedTeams}
                  effectiveScope={editScope}
                  teamNames={teamNames}
                  expanded={scopeExpanded}
                  onToggleExpand={() => setScopeExpanded((v) => !v)}
                  onToggleTeam={(slug) =>
                    setEditScope((prev) => {
                      const set = new Set(prev);
                      if (set.has(slug)) set.delete(slug); else set.add(slug);
                      return armedSlugs.filter((s) => set.has(s));
                    })
                  }
                  onPersonal={() => setEditScope([])}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', marginTop: 4 }}>
              <FooterBtn variant="ghost" onClick={(e?: any) => { e?.stopPropagation?.(); cancel(); }}>Cancel</FooterBtn>
              <FooterBtn onClick={(e?: any) => { e?.stopPropagation?.(); save(); }}>Save</FooterBtn>
            </div>
          </>
        ) : (
          <>
            <div
              style={{ fontSize: 12, color: tag.comment ? '#d6d6d6' : '#6c7588', lineHeight: 1.35, wordWrap: 'break-word', whiteSpace: 'pre-wrap', fontStyle: tag.comment ? 'normal' : 'italic' }}
            >
              {tag.comment ? <MentionedComment text={tag.comment} /> : '(no comment)'}
            </div>
            {canScope && (
              <div style={{ fontSize: 10, color: '#6c7588', marginTop: 1 }}>
                Visible to: {scopeLabel(tag.scope ?? [], armedSlugs, teamNames)}
              </div>
            )}
          </>
        )}
      </div>
      {(canEdit || canDelete) && !editing && (
        <div style={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                beginEdit();
              }}
              title="Edit this tag"
              style={{ background: 'transparent', border: 0, color: '#6c7588', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#d6e7ff'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#6c7588'; }}
            >
              ✎
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="Delete this tag"
              style={{ background: 'transparent', border: 0, color: '#6c7588', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ff7a7a'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#6c7588'; }}
            >
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function VisibilityPill({
  visibility,
  busy,
  onClick,
}: {
  visibility: string;
  busy: boolean;
  onClick: () => void;
}) {
  const isPublic = visibility === 'public';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={isPublic ? 'Click to make unlisted' : 'Click to make public'}
      style={{
        background: 'transparent',
        border: `1px solid ${isPublic ? '#3a6a3a' : '#4a4e56'}`,
        color: isPublic ? '#6bd968' : '#a0a8b8',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        cursor: busy ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        opacity: busy ? 0.6 : 1,
        textTransform: 'lowercase',
        letterSpacing: '0.04em',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: isPublic ? '#6bd968' : '#6c7588',
          marginRight: 6,
          verticalAlign: 'middle',
        }}
      />
      {visibility}
    </button>
  );
}

// B42's in-sidebar DecksDisclosure was removed in B64 — see the
// "View decks →" button + DecksModal above for the replacement.
