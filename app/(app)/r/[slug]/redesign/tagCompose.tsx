'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { getOrCreateInstallToken } from '@/lib/installToken';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { ViewerTag } from './TagsFeature';

// B216 redesign — shared tag actions (create / reply / edit / "is mine"), so the
// list, the HUD, and the feed all post the same way + share the signed-out gate.
// Optimistically appends/updates in ORIGINAL frame space (the viewer remaps to
// the collapsed timeline) — mirrors the legacy TagSidebar.submitTag.
export function useCreateTag(
  replaySlug: string,
  toOriginalFrame: (i: number) => number,
  appendTag: (t: ViewerTag) => void,
  updateTag?: (id: string, patch: Partial<ViewerTag>) => void,
) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id || null;
  const authorName = session?.user?.name || 'You';
  const [token] = useState(() => (typeof window !== 'undefined' ? getOrCreateInstallToken() : ''));
  // A tag is the viewer's own (editable) if it matches their account or token.
  const isMine = (tag: { userId?: string | null; authorToken?: string }) =>
    (!!userId && tag.userId === userId) || (!!token && !!tag.authorToken && tag.authorToken === token);

  const edit = async (id: string, text: string): Promise<boolean> => {
    const body = text.trim();
    if (!body) return false;
    try {
      const res = await fetch(`/api/replays/${replaySlug}/tags/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Install-Token': token } : {}) },
        body: JSON.stringify({ comment: body }),
      });
      const r = await res.json();
      if (!r.ok) { alert(`Failed to edit: ${r.error || 'unknown'}`); return false; }
      updateTag?.(id, { comment: body });
      return true;
    } catch { alert('Network error editing tag.'); return false; }
  };

  // parentTagId set → a one-level reply (B78): the server anchors it to the
  // parent's frame + inherits its scope; we append it in that frame too.
  const create = async (currentIndex: number, text: string, parentTagId?: string): Promise<boolean> => {
    const body = text.trim();
    if (!body) return false;
    const origFrame = toOriginalFrame(currentIndex);
    try {
      const res = await fetch(`/api/replays/${replaySlug}/tags`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Install-Token': token } : {}) },
        body: JSON.stringify({ installToken: token, authorName, frameIndex: origFrame, comment: body, ...(parentTagId ? { parentTagId } : {}) }),
      });
      const r = await res.json();
      if (!r.ok) { alert(`Failed to add tag: ${r.error || 'unknown'}`); return false; }
      appendTag({ id: r.id, frameIndex: origFrame, authorToken: token, authorName, comment: body, createdAt: new Date().toISOString(), scope: r.scope ?? [], parentTagId: parentTagId ?? null });
      return true;
    } catch { alert('Network error adding tag.'); return false; }
  };

  return { signedIn: !!userId, authorName, isMine, create, edit };
}

// The signed-out gate shared by both compose surfaces (matches the prod CTA).
export function SignInToTagCta({ replaySlug, compact }: { replaySlug: string; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: compact ? 10 : 12, background: tokens.color.primarySoft, border: '1px solid rgba(77,157,255,0.3)', borderRadius: 8, textAlign: 'center' }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#cfe3ff' }}>Sign in to tag this replay</span>
      {!compact && <span style={{ fontSize: 11, color: tokens.color.textSecondary, lineHeight: 1.4 }}>Tags are tied to your account so they count and can be submitted as a review.</span>}
      <a href={`/signin?callbackUrl=${encodeURIComponent(`/r/${replaySlug}`)}`}
        style={{ alignSelf: 'center', background: 'rgba(77,157,255,0.16)', color: '#9fc4ff', border: '1px solid rgba(77,157,255,0.45)', borderRadius: 6, padding: '6px 16px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none' }}>Sign in →</a>
    </div>
  );
}
