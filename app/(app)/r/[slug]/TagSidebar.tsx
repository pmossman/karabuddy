'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LedToggle } from '@/app/_components/LedToggle';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { useSession } from 'next-auth/react';
import type { Frame, MatchMeta, DecksByUserId } from '@/lib/replayDecoder';
import { getOrCreateInstallToken, getOrCreateAuthorName } from '@/lib/installToken';
import { canDeleteTag, canEditTag, canMutateReplay, type AuthContext } from '@/lib/replayPermissions';
import { Popover } from '@/app/_components/Popover';
import { useConfirm } from '@/app/_components/Confirm';
import { DecksModal } from './DecksModal';
import { ClipsList, type ClipSummary } from './ClipsList';
import { SharePopover } from './SharePopover';
import { MatchupInfo, useShareMoment } from './MatchupInfo';
import { copyToClipboard } from '@/lib/clipboard';
import { MentionInput, MentionedComment, type MentionData } from './MentionInput';
import { type SeriesInfo } from './SeriesNav';
// B71: shared scope-derivation — same module the extension copies, so the
// web comment form and the in-game bubble narrow audiences identically.
import { scopeFromMentions, scopeLabel } from '@/lib/commentScope';
import { encryptForTeam } from '@/lib/companion';
import { Grabber } from './useDragSize';
import { ReviewStatusHeader } from './ReviewStatusHeader';
import { FinishReviewModal } from './FinishReviewModal';

interface ReplayRow {
  slug: string;
  players: any;
  durationMs: number;
  actionCount: number;
  // Ownership fields. userId/ownerToken drive both sharing (B6) and B7
  // (replay-owner can delete other people's tags).
  userId: string | null;
  ownerToken: string;
  // B53: optional user-set display name + labels. Both null on replays
  // never edited.
  displayName?: string | null;
  labels?: string[] | null;
  winners?: string[] | null;
  // B170 / ADR 0010: private replay → comments are encrypted client-side via the
  // extension bridge under this team key before they're POSTed.
  encrypted?: boolean;
  teamKeyId?: string | null;
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
  // B55c: structured @-mentions, so the edit form can pre-fill them.
  mentions?: { userIds: string[]; teamSlugs: string[] } | null;
  // B78: set on a reply → the id of the top-level tag it threads under.
  parentTagId?: string | null;
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
  // Tags are passed in COLLAPSED frame space (positioned for display). When
  // writing a tag we must convert the current collapsed frame back to the
  // ORIGINAL recorder index the DB stores — `toOriginalFrame` does that.
  tags: TagRow[];
  setTags: React.Dispatch<React.SetStateAction<TagRow[]>>;
  toOriginalFrame: (collapsedIndex: number) => number;
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
  // B100: the mobile review-sheet drag size lives in ReplayViewer (single
  // source of truth so the chevrons + FABs ride with the sheet). This drawer
  // just consumes the live size and spreads the handle props onto its grabber.
  reviewSize: number;
  reviewDragging: boolean;
  reviewHandleProps: React.HTMLAttributes<HTMLDivElement>;
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
  // B122: anonymized viewer — propagates to the decks modal (hide deck-page link).
  anonymize?: boolean;
  // B129: the games of this replay's Bo3 series — Game-N title suffix + hop pills.
  series?: SeriesInfo | null;
  localPlayerId: string | null;
  // B71: teams the comment author can scope a tag to here = teams they're
  // in that this replay is shared with (audience ⊆ shares). Drives the
  // scope chip; empty / single → no chip (nothing to narrow).
  armedTeams: { slug: string; name: string }[];
  // Lets ShareWithTeam push live share changes back up to `armedTeams` so the
  // scope chip stays truthful when the owner re-shares mid-session.
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
  // B101: open the per-game resourcing report (analyzed in the viewer).
  onOpenResourcing?: () => void;
  // B150: open the sideboard-changes splash (swaps vs the previous game).
  onOpenSideboard?: () => void;
  // B138: clips already created on this replay (desktop Clips section).
  clips?: ClipSummary[];
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

export function TagSidebar({ replay, frames, currentIndex, lastTransition, onStep, onJump, onJumpToAdjacentTag, tags, setTags, toOriginalFrame, playerUsernames, mode, setMode, messagesByFrame, drawerOpen, setDrawerOpen, isMobile, reviewSize, reviewDragging, reviewHandleProps, mobileLandscape, mobilePortrait, sidebarWidth, setSidebarWidth, matchMeta, decks, localPlayerId, armedTeams, onArmedTeamsChange, onOpenResourcing, onOpenSideboard, anonymize, series, clips }: Props) {
  const { data: session } = useSession();
  const { confirm, confirmDialog } = useConfirm();
  const [installToken, setInstallToken] = useState('');
  const [authorName, setAuthorName] = useState('');
  // B194: "Finish review" summary modal (the team being finished) + a bump that
  // re-fetches the review-status header after a submit (tags.length won't change).
  const [finishTeam, setFinishTeam] = useState<{ teamSlug: string; teamName: string; alreadyReviewed: boolean } | null>(null);
  const [reviewBump, setReviewBump] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  // B76: immediate submitting feedback so the Save button shows progress the
  // moment it's clicked (the POST can take a beat).
  const [submittingTag, setSubmittingTag] = useState(false);
  // B78: one-level reply threading. Which top-level tag the inline reply form
  // is open under, its draft, and an in-flight flag for the submit button.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [decksOpen, setDecksOpen] = useState(false);
  // B100: on mobile the sheet is too short to show both the game log and the
  // tags/discussion at once, so they split into two tabs. Desktop (tall docked
  // sidebar) ignores this and stacks both. Default to the log — "what happened
  // here" is the context you read before tagging/discussing.
  // B149: the review panel is primary; the karabast game log lives behind a
  // Review|Log segmented toggle (desktop too, not just mobile), so each gets the
  // full panel height instead of fighting for it stacked. Default to whichever
  // has content — Review when there are visible comments, the game log when none
  // (an empty review panel is useless). Lazy-init from the SSR'd tags, then the
  // effect below re-defaults once the scoped fetch resolves; a manual toggle wins.
  const topLevelTagCount = tags.filter((t) => !t.parentTagId).length;
  const [panelTab, setPanelTab] = useState<'log' | 'tags'>(() => (topLevelTagCount > 0 ? 'tags' : 'log'));
  const userPickedTabRef = useRef(false);
  useEffect(() => {
    if (userPickedTabRef.current) return;
    setPanelTab(topLevelTagCount > 0 ? 'tags' : 'log');
  }, [topLevelTagCount]);
  // B149: stamp this visit + capture the PREVIOUS visit time, so tags left by
  // others since then get a "new" marker. Signed-in only (per-user tracking).
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null);
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
  // B12: sidebar width starts at the default during SSR/first paint, then
  // hydrates from localStorage in an effect to avoid hydration mismatch.
  // B66b: sidebarWidth state moved up to ReplayViewer; props are passed
  // in. This local placeholder kept only to silence the unused-default
  // constant — actual state is the props above.
  const [resizeHandleHover, setResizeHandleHover] = useState(false);
  const [resizeHandleActive, setResizeHandleActive] = useState(false);
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const sessionUserId: string | null = (session?.user?.id as string | undefined) || null;

  // B149: stamp this visit + capture the PREVIOUS visit time (for the "new"
  // markers). Below sessionUserId so it can gate on a signed-in viewer.
  useEffect(() => {
    if (!sessionUserId) return;
    let live = true;
    fetch(`/api/replays/${replay.slug}/viewed`, { method: 'POST' })
      .then((r) => r.json())
      .then((b) => { if (live && b?.ok) setLastViewedAt(b.previousViewedAt ?? null); })
      .catch(() => {});
    return () => { live = false; };
  }, [sessionUserId, replay.slug]);

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
  // account identity. B84: account name (no karabast username).
  useEffect(() => {
    const su = session?.user;
    if (su?.name) setAuthorName(su.name);
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

  // B113/B196: copy a link to the CURRENT frame so it unfurls into that board
  // state. The hook is shared so the mobile matchup panel offers it too.
  const { copied: momentCopied, share: shareMoment } = useShareMoment(replay.slug, currentIndex, toOriginalFrame);

  // B113: share a TAGGED moment — mint a signed token (server re-checks the
  // caller can see this tag) so the unfurl may surface the tag text. Returns
  // the URL (also copied) or null on failure.
  const shareTag = async (tag: TagRow): Promise<string | null> => {
    try {
      const res = await fetch(`/api/replays/${replay.slug}/share-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(installToken ? { 'X-Install-Token': installToken } : {}) },
        body: JSON.stringify({ frameIndex: tag.frameIndex, tagId: tag.id }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      const url: string | null = typeof body?.url === 'string'
        ? body.url
        : (body?.token ? `${window.location.origin}/r/${replay.slug}?f=${tag.frameIndex + 1}&t=${body.token}` : null);
      if (url) await copyToClipboard(url);
      return url;
    } catch {
      return null;
    }
  };


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

  // B170 / ADR 0010: the comment field for a tag write — ciphertext (encrypted
  // via the extension bridge under the team key) on a private replay, plaintext
  // otherwise. The key never reaches the page.
  const commentField = async (text: string): Promise<Record<string, unknown>> => {
    if (replay.encrypted && replay.teamKeyId) {
      const envelope = await encryptForTeam(replay.teamKeyId, text);
      return { commentEncrypted: JSON.stringify(envelope) };
    }
    return { comment: text };
  };

  const submitTag = async () => {
    if (!installToken || !frames || submittingTag) return;
    const hasMentions = draftMentions.userIds.length > 0 || draftMentions.teamSlugs.length > 0;
    setSubmittingTag(true);
    let body: any;
    try {
      const commentBody = await commentField(draft);
      const res = await fetch(`/api/replays/${replay.slug}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installToken,
          authorName,
          frameIndex: toOriginalFrame(currentIndex),
          ...commentBody,
          // B55c: structured mentions selected via autocomplete. Only sent
          // when non-empty so old API consumers stay backward-compatible.
          ...(hasMentions ? { mentions: draftMentions } : {}),
          // B71: only send teamSlugs when the chip is in play (replay shared
          // with 2+ of my teams). With 0/1 armed teams the server default
          // (all shares) is already correct, so we stay backward-compatible.
          ...(showScopeChip ? { teamSlugs: effectiveScope } : {}),
        }),
      });
      body = await res.json();
    } catch {
      body = { ok: false, error: 'network error' };
    } finally {
      setSubmittingTag(false);
    }
    if (!body.ok) {
      alert(`Failed to add tag: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => [
      ...prev,
      {
        id: body.id,
        replaySlug: replay.slug,
        // Stored (and kept in state) in ORIGINAL space; the parent remaps it
        // back to this collapsed frame for display.
        frameIndex: toOriginalFrame(currentIndex),
        authorToken: installToken,
        authorName,
        comment: draft,
        createdAt: new Date().toISOString(),
        // Carry the SERVER-resolved audience (+ mentions) so the new comment's
        // "Visible to:" readout is correct immediately. Without this the
        // optimistic row had no scope and rendered as "Just me" until a refetch,
        // even though the tag was saved team-scoped.
        scope: body.scope ?? [],
        mentions: hasMentions ? draftMentions : null,
      },
    ]);
    setDraft('');
    setDraftMentions({ userIds: [], teamSlugs: [] });
    resetScope();
    setFormOpen(false);
  };

  // Lazy-load the mention autocomplete data when the user first opens
  // the tag form. Fails silently if not signed in or no teams — popover
  // just doesn't appear. Loaded once; triggered when the new-tag form opens
  // AND when a row enters edit (so @-mention autocomplete works there too).
  const ensureMentionData = () => {
    if (mentionLoadedRef.current) return;
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
  };
  useEffect(() => {
    if (formOpen) ensureMentionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formOpen]);

  const deleteTag = async (id: string) => {
    if (!(await confirm({ title: 'Delete this tag?', message: 'This permanently removes the comment from the replay.', confirmLabel: 'Delete', destructive: true }))) return;
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
  const updateComment = async (
    id: string,
    comment: string,
    teamSlugs?: string[],
    mentions?: { userIds: string[]; teamSlugs: string[] },
  ) => {
    const commentBody = await commentField(comment);
    const res = await fetch(`/api/replays/${replay.slug}/tags/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
      body: JSON.stringify({
        ...commentBody,
        ...(teamSlugs !== undefined ? { teamSlugs } : {}),
        ...(mentions !== undefined ? { mentions } : {}),
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      alert(`Failed to update: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => prev.map((t) => (t.id === id
      ? { ...t, comment, ...(body.scope ? { scope: body.scope } : {}), ...(mentions !== undefined ? { mentions } : {}) }
      : t)));
  };

  const tagsAtCurrent = tagsByFrame.get(currentIndex) || [];

  // B132: landing on an annotated frame (tag click in the list, [ / ] keys,
  // the board-edge tag-jump buttons, or plain stepping) scrolls the tag list
  // back to the top, where the "This frame" callout now holds that comment —
  // otherwise a click on a far-down tag jumps the board but leaves you
  // scrolled past the very comment you wanted to read. Scroll ONLY the list
  // container (the B102 lesson: scrollIntoView bubbles to ancestor scrollers
  // and nudges the whole page).
  const tagListScrollRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const c = tagListScrollRef.current;
    if (!c) return;
    if (!(tagsByFrame.get(currentIndex) || []).length) return;
    c.scrollTo({ top: 0, behavior: 'smooth' });
    // Only on frame changes — a tags refetch or a new comment mid-read must
    // not yank the reader's scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  // B78: replies grouped by their parent tag id, oldest-first within a thread.
  const repliesByParent = useMemo(() => {
    const m = new Map<string, TagRow[]>();
    for (const t of tags) {
      if (!t.parentTagId) continue;
      const list = m.get(t.parentTagId) ?? [];
      list.push(t);
      m.set(t.parentTagId, list);
    }
    for (const list of m.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    return m;
  }, [tags]);

  const submitReply = async (parentTagId: string, parentFrame: number) => {
    if (!installToken || replySubmitting || !replyDraft.trim()) return;
    setReplySubmitting(true);
    let body: any;
    try {
      // The server inherits the parent's frame + scope and auto-@mentions the
      // parent author, so the reply form only needs the text.
      const commentBody = await commentField(replyDraft.trim());
      const res = await fetch(`/api/replays/${replay.slug}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installToken, authorName, frameIndex: toOriginalFrame(parentFrame), ...commentBody, parentTagId }),
      });
      body = await res.json();
    } catch {
      body = { ok: false, error: 'network error' };
    } finally {
      setReplySubmitting(false);
    }
    if (!body.ok) {
      alert(`Failed to reply: ${body.error || 'unknown'}`);
      return;
    }
    setTags((prev) => [
      ...prev,
      {
        id: body.id,
        replaySlug: replay.slug,
        frameIndex: toOriginalFrame(parentFrame),
        authorToken: installToken,
        authorName,
        comment: replyDraft.trim(),
        createdAt: new Date().toISOString(),
        scope: body.scope,
        parentTagId,
      },
    ]);
    setReplyDraft('');
    setReplyingTo(null);
  };

  const replyLinkStyle: React.CSSProperties = {
    alignSelf: 'flex-start', background: 'transparent', border: 0, padding: '2px 0',
    color: '#6c7588', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  };

  // B149: a tag is "new" if someone ELSE left it since the viewer's last visit
  // (own comments never flag as new). lastViewedAt is null on a first-ever visit
  // — nothing is "new" then (it's all new, so the marker would be noise).
  const isMineTag = (t: TagRow) => (!!t.userId && t.userId === sessionUserId) || t.authorToken === installToken;
  const isNewTag = (t: TagRow) => !!lastViewedAt && !isMineTag(t) && t.createdAt > lastViewedAt;

  // B78: render a top-level tag with its replies nested one level beneath,
  // plus an inline Reply affordance. Replies reuse TagRowView (no further
  // reply button — one level only).
  const renderThread = (t: TagRow, isCurrent: boolean) => {
    const rowFor = (tag: TagRow, current: boolean) => (
      <TagRowView
        key={tag.id}
        tag={tag}
        color={tagColor(tag.authorName, playerUsernames)}
        isCurrent={current}
        isNew={isNewTag(tag)}
        canEdit={canEditTag(tag, authCtx)}
        canDelete={canDeleteTag(tag, { userId: replay.userId, ownerToken: replay.ownerToken }, authCtx)}
        armedTeams={armedTeams}
        mentionData={mentionData}
        ensureMentionData={ensureMentionData}
        onJumpTo={() => onJump(tag.frameIndex)}
        onDelete={() => deleteTag(tag.id)}
        onShare={() => shareTag(tag)}
        onUpdate={(comment, teamSlugs, mentions) => updateComment(tag.id, comment, teamSlugs, mentions)}
      />
    );
    const replies = repliesByParent.get(t.id) ?? [];
    const open = replyingTo === t.id;
    const nested = replies.length > 0 || open;
    return (
      <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rowFor(t, isCurrent)}
        <div
          style={{
            marginLeft: 14,
            paddingLeft: 8,
            borderLeft: nested ? '2px solid #2e333c' : 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {replies.map((r) => rowFor(r, false))}
          {installToken && (open ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                autoFocus
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder={`Reply to ${t.authorName}…`}
                rows={2}
                style={{
                  background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c',
                  borderRadius: 4, padding: '6px 8px', font: '12px inherit', resize: 'vertical', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <FooterBtn variant="ghost" onClick={() => { setReplyingTo(null); setReplyDraft(''); }}>Cancel</FooterBtn>
                <FooterBtn onClick={() => submitReply(t.id, t.frameIndex)} disabled={replySubmitting}>
                  {replySubmitting ? 'Replying…' : 'Reply'}
                </FooterBtn>
              </div>
            </div>
          ) : (
            <button type="button" style={replyLinkStyle} onClick={() => { setReplyingTo(t.id); setReplyDraft(''); }}>
              ↳ Reply
            </button>
          ))}
        </div>
      </div>
    );
  };

  // B44/B66: mobile drawer styling overrides desktop's flex-child positioning.
  // The aside takes itself out of normal flow with position:fixed so the
  // gameboard's flex container reclaims the width; the drawer slides in/out
  // via transform, which animates cheaper than width. Landscape anchors to
  // the RIGHT edge; portrait anchors to the BOTTOM (slides up) so the
  // gameboard remains visible above between the top MatchupPanel and this
  // drawer.
  // B100: while dragging, kill the slide transition so the sheet tracks the
  // finger 1:1; restore it for the open/close slide.
  const sheetTransition = reviewDragging
    ? 'none'
    : 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)';
  const asideStyle: React.CSSProperties = mobilePortrait
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: reviewSize,
        zIndex: 80,
        transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
        transition: sheetTransition,
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
        // Draggable WIDTH; the grabber lives on the left edge (paddingLeft
        // keeps content clear of it).
        position: 'fixed',
        top: 'var(--kb-header-h, 0px)',
        right: 0,
        bottom: 0,
        width: reviewSize,
        paddingLeft: 22,
        zIndex: 80,
        transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: sheetTransition,
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
      {confirmDialog}
      {/* B44/B66b/B100: the ☰ review toggle (log + tags). On DESKTOP it
          shifts horizontally past the docked sidebar when open so it isn't
          buried. On MOBILE it's pinned to the bottom-right corner and stays
          put — the sheet has its own × + drag handle + backdrop to close, so
          the FAB no longer needs to chase the drawer (chasing it is what made
          the old layout feel broken). The matchup (ⓘ) FAB sits just above it,
          rendered by ReplayViewer. The mobile backdrop also lives in
          ReplayViewer (shared between both sheets). */}
      {(() => {
        // B100: on mobile the ☰ FAB rides clear of the open sheet (up past a
        // portrait bottom sheet, left past a landscape right sheet) so it never
        // overlays the drawer. Desktop keeps hugging the docked sidebar.
        const edgeR = 'max(12px, env(safe-area-inset-right, 12px))';
        const edgeB = 'max(12px, env(safe-area-inset-bottom, 12px))';
        const right = !isMobile
          ? (drawerOpen ? `calc(${sidebarWidth}px + 12px)` : edgeR)
          : (mobileLandscape && drawerOpen ? `calc(${reviewSize}px + 12px)` : edgeR);
        const bottom = mobilePortrait && drawerOpen ? `calc(${reviewSize}px + 12px)` : edgeB;
        return (
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-label={drawerOpen ? 'Close tags panel' : 'Open tags panel'}
            title={drawerOpen ? 'Close review' : 'Open review'}
            style={{
              position: 'fixed',
              bottom,
              right,
              zIndex: 90,
              width: 38,
              height: 38,
              background: drawerOpen ? 'rgba(77, 157, 255, 0.32)' : 'rgba(36, 48, 68, 0.85)',
              color: '#d6e7ff',
              border: '1px solid rgba(77, 157, 255, 0.4)',
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
              transition: reviewDragging
                ? 'background 160ms ease'
                : 'right 220ms cubic-bezier(0.4, 0, 0.2, 1), bottom 220ms cubic-bezier(0.4, 0, 0.2, 1), background 160ms ease',
            }}
          >
            ☰
          </button>
        );
      })()}

      {/* Keyframes scoped inline so this file remains self-contained —
          referenced by the shared mobile backdrop in ReplayViewer. */}
      <style>{`@keyframes kb-fade-in { from { opacity: 0; } to { opacity: 1; } }`}</style>

      {/* B66b: desktop unmounts the aside when closed so the gameboard
          flex-sibling reclaims width. Mobile keeps it mounted and slides
          out via transform so internal state (scroll, popovers) survives. */}
      {(isMobile || drawerOpen) && (
      <aside data-testid="tags-drawer" style={asideStyle}>
      {/* B100: clear drag handle to resize the mobile sheet. Portrait → a
          horizontal grabber at the sheet's TOP edge (flows above the header).
          Landscape → a vertical grabber pinned to the sheet's LEFT edge
          (absolute, so it doesn't disturb the column flow; the aside's
          paddingLeft keeps content clear of it). */}
      {mobilePortrait && (
        <Grabber
          orientation="horizontal"
          dragging={reviewDragging}
          label="Drag to resize review panel"
          handleProps={reviewHandleProps}
        />
      )}
      {isMobile && !mobilePortrait && (
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 22, zIndex: 10 }}>
          <Grabber
            orientation="vertical"
            dragging={reviewDragging}
            label="Drag to resize review panel"
            handleProps={reviewHandleProps}
          />
        </div>
      )}
      {/* B10: compact header — leader+base per player, share collapsed
          into a top-right popover. B12: usernames now wrap to their own
          line beneath the thumbs, so the row aligns to the top of the
          thumbs to keep VS visually centered against the cards (not the
          taller two-line player column). B66: hidden on ANY mobile —
          the MatchupPanel (left on landscape, top on portrait) takes
          over this content. */}
      {!isMobile && (
      <header style={{ padding: '10px 14px 10px 16px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        {/* B196: the shared matchup-identity block (chips/title/series/labels/
            players) — same component the mobile panel renders. Share stays
            inline beside the players here via the `share` slot. */}
        <MatchupInfo
          replay={replay}
          matchMeta={matchMeta}
          installToken={installToken}
          isOwner={isOwner}
          anonymize={anonymize}
          series={series}
          variant="sidebar"
          share={
            <SharePopover
              replaySlug={replay.slug}
              installToken={installToken}
              isOwner={isOwner}
              asSheet={false}
              onArmedTeamsChange={onArmedTeamsChange}
              shareMoment={{ copied: momentCopied, onClick: shareMoment }}
            />
          }
        />
      </header>
      )}

      {/* B48/B66/B66b: frame-counter row inside the drawer on every
          viewport. Step-by toggle and prev/next arrows moved out to the
          gameboard overlays (StepModeOverlay + FrameNavOverlay). B100: on
          mobile this row doubles as the sheet header — a "Review" label on
          the left and an explicit × close on the right (the FAB is covered
          while the sheet is open, so the sheet needs its own dismiss). */}
      <section style={{ padding: '8px 14px 10px 16px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'space-between' : 'center', gap: 8 }}>
        {isMobile && (
          <span style={{ fontSize: 10, color: '#6c7588', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Review</span>
        )}
        <span data-testid="frame-counter" style={{ fontSize: 11, color: '#d6d6d6', fontWeight: 600 }}>
          {frames ? `Frame ${currentIndex + 1} / ${frames.length}` : '…'}
        </span>
        {isMobile && (
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close tags panel"
            title="Close review"
            style={{ background: 'transparent', color: '#a0a8b8', border: 0, fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 0, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ×
          </button>
        )}
      </section>

      {/* B149: Review|Log toggle on EVERY viewport — the review panel is primary,
          the game log secondary. (Was mobile-only; desktop used to stack both.) */}
      <section style={{ padding: '8px 14px', borderBottom: '1px solid #2e333c', flex: '0 0 auto', display: 'flex', gap: 6 }}>
        <DrawerTab active={panelTab === 'tags'} onClick={() => { userPickedTabRef.current = true; setPanelTab('tags'); }}>
          Tags{topLevelTagCount > 0 ? ` (${topLevelTagCount})` : ''}
        </DrawerTab>
        <DrawerTab active={panelTab === 'log'} onClick={() => { userPickedTabRef.current = true; setPanelTab('log'); }}>Game log</DrawerTab>
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
              <ModeSegmented mode={mode} setMode={setMode} />
            </Popover>
          </div>
        </section>
      )}

      {panelTab === 'log' && (
        <FrameLog
          messagesByFrame={messagesByFrame}
          currentIndex={currentIndex}
          lastTransition={lastTransition}
          frames={frames}
        />
      )}

      {panelTab === 'tags' && (
      <>
      {/* B149: review-status strip — reviewer marks + in-place "Mark reviewed"
          for the viewer's teams with an open request (refetches when a comment
          is added, so the comment-gate flips live). */}
      <ReviewStatusHeader replaySlug={replay.slug} refreshKey={tags.length + reviewBump} onFinish={setFinishTeam} />
      {finishTeam && (
        <FinishReviewModal
          teamName={finishTeam.teamName}
          alreadyReviewed={finishTeam.alreadyReviewed}
          comments={tags
            .filter((t) => isMineTag(t) && !t.parentTagId && (t.scope ?? []).includes(finishTeam.teamSlug))
            .sort((a, b) => a.frameIndex - b.frameIndex)
            .map((t) => ({ id: t.id, frameIndex: t.frameIndex, comment: t.comment }))}
          onEdit={(id, text) => updateComment(id, text)}
          onDelete={(id) => deleteTag(id)}
          onJump={(f) => { onJump(f); setFinishTeam(null); }}
          onSubmit={async () => {
            try {
              const res = await fetch(`/api/replays/${replay.slug}/reviewed`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamSlug: finishTeam.teamSlug, reviewed: true }),
              });
              const body = await res.json().catch(() => ({}));
              if (body.ok) { setReviewBump((n) => n + 1); return { ok: true }; }
              return { ok: false, error: body.error || 'Could not submit' };
            } catch { return { ok: false, error: 'Network error' }; }
          }}
          onClose={() => setFinishTeam(null)}
        />
      )}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, background: 'rgba(77, 157, 255, 0.08)', border: '1px solid rgba(77, 157, 255, 0.3)', borderRadius: 6 }}>
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
              <FooterBtn onClick={submitTag} disabled={submittingTag}>{submittingTag ? 'Saving…' : 'Save tag'}</FooterBtn>
            </div>
          </div>
        )}
      </section>

      <section ref={tagListScrollRef} style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable', padding: '14px 22px', borderTop: '1px solid #2e333c' }}>
        {/* B149: three explicit sections — This frame (current) · Upcoming
            (ahead, nearest-first) · Previous (behind, nearest-first, collapsed
            by default). Replaces the B132 "only at-or-after" view, which hid the
            backlog the reviewer wants back. */}
        {tags.length === 0 ? (
          <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>No tags yet. Click &quot;+ Tag this frame&quot; to add one.</div>
        ) : (
          (() => {
            const top = (t: TagRow) => !t.parentTagId;
            const current = tagsAtCurrent.filter(top);
            const upcoming = tags.filter((t) => top(t) && t.frameIndex > currentIndex).sort((a, b) => a.frameIndex - b.frameIndex);
            const previous = tags.filter((t) => top(t) && t.frameIndex < currentIndex).sort((a, b) => b.frameIndex - a.frameIndex);
            const label: React.CSSProperties = { fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' };
            const empty: React.CSSProperties = { fontSize: 11, color: '#6c7588', fontStyle: 'italic' };
            return (
              <>
                {/* This frame — only when there's something here. */}
                {current.length > 0 && (
                  <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={label}>This frame</div>
                    {current.map((t) => renderThread(t, true))}
                  </div>
                )}

                {/* Upcoming — ahead of the current frame, nearest-first. */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ ...label, marginBottom: 8 }}>Upcoming ({upcoming.length})</div>
                  {upcoming.length === 0
                    ? <div style={empty}>Nothing tagged ahead.</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{upcoming.map((t) => renderThread(t, false))}</div>}
                </div>

                {/* Previous — behind the current frame, nearest-first. Lives at
                    the bottom of the scroll area, so it's always expanded. */}
                <div>
                  <div style={{ ...label, marginBottom: 8 }}>Previous ({previous.length})</div>
                  {previous.length === 0
                    ? <div style={empty}>Nothing tagged earlier.</div>
                    : <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{previous.map((t) => renderThread(t, false))}</div>}
                </div>
              </>
            );
          })()
        )}
      </section>
      </>
      )}

      {/* B42 / B64 / B66: deck snapshot launcher. Hidden on ANY mobile
          — the MatchupPanel (left/top) owns the View-decks button so
          the drawer stays slim and dedicated to discussion. */}
      {/* B149: matchup-info actions — the resourcing report (moved here out of
          the review panel) above View decks. Desktop only; mobile surfaces both
          in the ⓘ MatchupPanel. */}
      {!isMobile && (onOpenResourcing || onOpenSideboard || (decks && Object.keys(decks).length > 0)) && (
        <section style={{ borderTop: '1px solid #2e333c', padding: '10px 22px', flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onOpenSideboard && (
            <button
              type="button"
              onClick={onOpenSideboard}
              style={{
                background: 'transparent', border: '1px solid #2e333c', borderRadius: 4,
                padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#a7d2ff',
                cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left',
              }}
            >
              ⇄ Sideboard changes
            </button>
          )}
          {onOpenResourcing && (
            <button
              type="button"
              onClick={onOpenResourcing}
              style={{
                background: 'transparent', border: '1px solid #2e333c', borderRadius: 4,
                padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#a7d2ff',
                cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left',
              }}
            >
              ⚡ Resourcing report
            </button>
          )}
          {decks && Object.keys(decks).length > 0 && (
            <button
              type="button"
              onClick={() => setDecksOpen(true)}
              style={{
                background: 'transparent', border: '1px solid #2e333c', borderRadius: 4,
                padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#a7d2ff',
                cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left',
              }}
            >
              View decks →
            </button>
          )}
        </section>
      )}
      {/* B138: clips on this replay — open a clip's reel. Desktop only (mobile
          surfaces them in the ⓘ matchup panel). */}
      {clips && clips.length > 0 && !isMobile && (
        <section style={{ borderTop: '1px solid #2e333c', padding: '10px 16px 12px', flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8b93a5', padding: '0 6px 6px' }}>
            Clips · {clips.length}
          </div>
          <ClipsList clips={clips} />
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
          anonymize={anonymize}
        />
      )}

      {/* B34: prev/next tag nav lives below the tag display, not above —
          natural "after you've read the current frame's tags, jump to the
          next one" flow. Hidden when there are no tags to jump to, and (mobile)
          only on the Tags tab. */}
      {panelTab === 'tags' && tags.length > 0 && (
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
              ? 'rgba(77, 157, 255, 0.45)'
              : resizeHandleHover
              ? 'rgba(77, 157, 255, 0.18)'
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
const PLAYER_COLOR_USER = '#5db4ff';
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
  //
  // B102: scroll ONLY the log container, computed manually. `element
  // .scrollIntoView()` bubbles up and also scrolls ancestor scrollers
  // (including the document, which has a little overflow) — so as the log
  // entry length changed frame-to-frame it scrolled the whole page a few
  // pixels, making the gameboard appear to shift vertically.
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const row = currentRowRef.current;
    if (row) {
      const cr = c.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      const delta = (rr.top - cr.top) - c.clientHeight / 2 + rr.height / 2;
      c.scrollTop += delta;
    } else {
      c.scrollTop = c.scrollHeight;
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
          // B102: reserve the scrollbar gutter so the log's scrollbar
          // appearing/disappearing between frames (as the entry length
          // changes) doesn't shift content or make the scrollbar "hop".
          scrollbarGutter: 'stable',
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
        background: active ? 'rgba(77, 157, 255, 0.18)' : 'transparent',
        border: `1px solid ${active ? '#4d9dff' : '#3a3e46'}`,
        borderRadius: 4,
        color: active ? '#5db4ff' : '#a0a8b8',
        cursor: 'pointer',
        flex: '0 0 auto',
      }}
    >
      {children}
    </button>
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
  const sel: React.CSSProperties = { background: '#4d9dff', color: 'white' };
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
          background: 'rgba(77, 157, 255, 0.08)',
          border: '1px solid rgba(77, 157, 255, 0.3)',
          color: '#a7d2ff',
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
              <LedToggle key={t.slug} checked={checked} onChange={() => onToggleTeam(t.slug)} label={t.name} />
            );
          })}
          <div style={{ borderTop: '1px solid #2e333c', paddingTop: 4, marginTop: 2 }}>
            <LedToggle checked={isPersonal} onChange={() => onPersonal()} label="Just me (personal)" shape="radio" />
          </div>
        </div>
      )}
    </div>
  );
}

// B100: mobile drawer tab — a full-width segmented control between the game
// log and the tags/discussion. Active tab gets the cyan-ish HUD fill + a
// bottom underline; inactive is muted.
function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: 1,
        background: active ? 'rgba(77, 157, 255, 0.16)' : 'transparent',
        border: `1px solid ${active ? 'rgba(77, 157, 255, 0.5)' : '#2e333c'}`,
        color: active ? '#a7d2ff' : '#6c7588',
        borderRadius: 6,
        padding: '7px 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function FooterBtn({
  children,
  onClick,
  variant = 'primary',
  alignSelf = false,
  fullWidth = false,
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: (e?: any) => void;
  variant?: 'primary' | 'ghost' | 'outline';
  alignSelf?: boolean;
  fullWidth?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const base: React.CSSProperties = {
    border: 0,
    borderRadius: 4,
    padding: '6px 10px',
    cursor: disabled ? 'wait' : 'pointer',
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
    base.border = `1px solid ${tokens.color.primary}`;
    base.color = tokens.color.accentBright;
  } else {
    // Primary = the glow button (dark gradient + glowing blue border).
    base.background = tokens.button.bg;
    base.color = tokens.color.accent;
    base.border = `1px solid ${tokens.color.primary}`;
    base.boxShadow = tokens.button.glow;
  }
  if (alignSelf) base.alignSelf = 'flex-start';
  if (fullWidth) { base.width = '100%'; base.padding = '8px 10px'; }
  if (disabled) base.opacity = 0.65;
  return (
    <button type="button" style={base} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

function TagRowView({
  tag,
  color,
  isCurrent,
  isNew,
  canEdit,
  canDelete,
  armedTeams,
  mentionData,
  ensureMentionData,
  onJumpTo,
  onDelete,
  onShare,
  onUpdate,
}: {
  tag: TagRow;
  color: string;
  isCurrent: boolean;
  // B149: someone else left this since the viewer's last visit.
  isNew?: boolean;
  // B7: split tag-author affordance into edit vs delete. Replay owners
  // get delete on other people's tags but never edit (don't put words in
  // their mouth).
  canEdit: boolean;
  canDelete: boolean;
  // B71: teams the viewer could scope this tag to (replay shares ∩ their
  // teams). Drives the per-tag "Visible to:" readout + edit chip.
  armedTeams: { slug: string; name: string }[];
  mentionData: MentionData | null;
  ensureMentionData: () => void;
  onJumpTo: () => void;
  onDelete: () => void;
  onShare?: () => Promise<string | null> | void;
  onUpdate: (comment: string, teamSlugs?: string[], mentions?: { userIds: string[]; teamSlugs: string[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.comment);
  const [shared, setShared] = useState(false); // B113: brief "copied" flash on share
  // B55c: @-mentions on the in-progress edit (pre-filled from the tag).
  const [editMentions, setEditMentions] = useState<{ userIds: string[]; teamSlugs: string[] }>(
    tag.mentions ?? { userIds: [], teamSlugs: [] },
  );
  // null = follow the mentions (mention-driven), else a manual override.
  const [scopeOverride, setScopeOverride] = useState<string[] | null>(tag.scope ?? []);
  const [scopeExpanded, setScopeExpanded] = useState(false);

  const armedSlugs = armedTeams.map((t) => t.slug);
  const teamNames = Object.fromEntries(armedTeams.map((t) => [t.slug, t.name])) as Record<string, string>;
  const canScope = armedSlugs.length >= 1; // replay shared with ≥1 of my teams

  const memberTeams = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const m of mentionData?.members ?? []) map[m.userId] = m.teamSlugs;
    return map;
  }, [mentionData]);
  const mentionDrivenScope = scopeFromMentions({ armedTeams: armedSlugs, mentionedUserIds: editMentions.userIds, memberTeams });
  const effectiveScope = scopeOverride ?? mentionDrivenScope;

  const beginEdit = () => {
    setDraft(tag.comment);
    setEditMentions(tag.mentions ?? { userIds: [], teamSlugs: [] });
    setScopeOverride(tag.scope ?? []);
    setScopeExpanded(false);
    ensureMentionData();
    setEditing(true);
  };
  const save = () => {
    onUpdate(draft.trim(), canScope ? effectiveScope : undefined, editMentions);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(tag.comment);
    setEditMentions(tag.mentions ?? { userIds: [], teamSlugs: [] });
    setScopeOverride(tag.scope ?? []);
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
        background: isCurrent ? 'rgba(77, 157, 255, 0.12)' : 'rgba(255,255,255,0.025)',
        borderLeft: `3px solid ${color}`,
        opacity: isCurrent ? 1 : 0.45,
        cursor: editing ? 'text' : 'pointer',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#a0a8b8', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color, fontWeight: 600 }}>{tag.authorName}</span>
          <span style={{ color: '#4a4e56' }}>·</span>
          <span>frame {tag.frameIndex + 1}</span>
          {isNew && (
            <span
              data-testid="tag-new-badge"
              title="New since your last visit"
              style={{ background: 'rgba(86, 199, 255, 0.18)', border: '1px solid rgba(86, 199, 255, 0.5)', color: '#8fd6ff', borderRadius: 999, padding: '0 6px', fontSize: 9, fontWeight: 800, letterSpacing: '0.05em' }}
            >
              NEW
            </span>
          )}
        </div>
        {editing ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <MentionInput
              value={draft}
              onChange={setDraft}
              onMention={(kind, id) => {
                setEditMentions((prev) => {
                  if (kind === 'user') return prev.userIds.includes(id) ? prev : { ...prev, userIds: [...prev.userIds, id] };
                  return prev.teamSlugs.includes(id) ? prev : { ...prev, teamSlugs: [...prev.teamSlugs, id] };
                });
                // A new mention re-drives the scope (until you touch the chip).
                setScopeOverride(null);
              }}
              mentionData={mentionData}
              autoFocus
              rows={2}
              onSubmit={save}
              onCancel={cancel}
              textareaStyle={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#11141a',
                color: '#e6e6e6',
                border: '1px solid #4d9dff',
                borderRadius: 4,
                padding: '4px 6px',
                font: '12px var(--font-barlow), -apple-system, sans-serif',
                resize: 'vertical',
                outline: 'none',
              }}
            />
            {canScope && (
              <div style={{ marginTop: 4 }}>
                <ScopeChip
                  armedTeams={armedTeams}
                  effectiveScope={effectiveScope}
                  teamNames={teamNames}
                  expanded={scopeExpanded}
                  onToggleExpand={() => setScopeExpanded((v) => !v)}
                  onToggleTeam={(slug) =>
                    setScopeOverride((prev) => {
                      const set = new Set(prev ?? effectiveScope);
                      if (set.has(slug)) set.delete(slug); else set.add(slug);
                      return armedSlugs.filter((s) => set.has(s));
                    })
                  }
                  onPersonal={() => setScopeOverride([])}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end', marginTop: 4 }}>
              <FooterBtn variant="ghost" onClick={(e?: any) => { e?.stopPropagation?.(); cancel(); }}>Cancel</FooterBtn>
              <FooterBtn onClick={(e?: any) => { e?.stopPropagation?.(); save(); }}>Save</FooterBtn>
            </div>
          </div>
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
          {onShare && (
            <button
              type="button"
              onClick={async (e) => {
                e.stopPropagation();
                const url = await onShare();
                if (url !== null) { setShared(true); window.setTimeout(() => setShared(false), 1800); }
              }}
              title="Copy a share link that unfurls into this moment + tag"
              style={{ background: 'transparent', border: 0, color: shared ? '#46d27a' : '#6c7588', cursor: 'pointer', padding: '0 4px', fontSize: 13, lineHeight: 1 }}
              onMouseEnter={(e) => { if (!shared) (e.currentTarget as HTMLButtonElement).style.color = '#a7d2ff'; }}
              onMouseLeave={(e) => { if (!shared) (e.currentTarget as HTMLButtonElement).style.color = '#6c7588'; }}
            >
              {shared ? '✓' : '↗'}
            </button>
          )}
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

// B42's in-sidebar DecksDisclosure was removed in B64 — see the
// "View decks →" button + DecksModal above for the replacement.
