'use client';

import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/app/_components/Confirm';
import { ReviewStar, ToggleNote, TeamShareRow, PublicShareSection, shareSectionLabel } from '@/app/_components/shareControls';

// B55b: replay-owner UI for sharing a replay explicitly with one or more
// of their teams. Lives inside the existing Share popover in TagSidebar.
// Renders nothing if the owner has zero teams (no-op state) — the user
// can join/create teams from /teams.
//
// Server-side rules enforced by /api/replays/[slug]/team-shares:
//   - GET returns existing shares + the owner's teams (so we can show
//     each team as a checkbox, ticked iff shared)
//   - POST adds a share row; owner-only AND caller must be a member of
//     the team being shared with
//   - DELETE removes a share row; owner-only
export function ShareWithTeam({
  replaySlug,
  installToken,
  onArmedTeamsChange,
}: {
  replaySlug: string;
  installToken: string;
  // Reports the LIVE shared subset (teams this replay is shared with, of the
  // owner's teams) so the comment scope chip tracks in-session share changes
  // instead of the page-load snapshot. Called on load + after every toggle.
  onArmedTeamsChange?: (teams: { slug: string; name: string }[]) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error' | 'unauth'>('loading');
  const [shares, setShares] = useState<Set<string>>(new Set());
  // B170/ADR 0010: `privateMode` + `shareable` per team so a private team a
  // plaintext replay can't go to renders disabled-with-reason, not a dead toggle.
  const [teams, setTeams] = useState<{ slug: string; name: string; privateMode?: boolean; shareable?: boolean }[]>([]);
  const [encrypted, setEncrypted] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // B135: teams this replay is flagged for review by (subset of shares).
  const [reviewTeams, setReviewTeams] = useState<Set<string>>(new Set());
  const [reviewPending, setReviewPending] = useState<Set<string>>(new Set());
  // B133: owner-controlled public sharing — anyone with the link (or via the
  // public browser) sees the game AND its comments, anonymized + redacted.
  const [isPublic, setIsPublic] = useState(false);
  const [publicPending, setPublicPending] = useState(false);
  // B100: tags on this replay scoped to each team — drives the "un-sharing
  // also removes N comments" confirmation.
  const [scopedCounts, setScopedCounts] = useState<Record<string, number>>({});
  // Pending un-share awaiting confirmation (only set when it would untag
  // comments from the team).
  const [confirm, setConfirm] = useState<{ slug: string; name: string; count: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/replays/${replaySlug}/team-shares`, {
          headers: { 'X-Install-Token': installToken },
        });
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 403) {
          // Non-owner — don't render anything. Should not happen because
          // the parent already gated on isOwner, but defense in depth.
          setState('unauth');
          return;
        }
        if (!body.ok) {
          setState('error');
          return;
        }
        setShares(new Set((body.shares || []).map((s: any) => s.teamSlug)));
        setReviewTeams(new Set((body.shares || []).filter((s: any) => s.reviewRequestedAt).map((s: any) => s.teamSlug)));
        setTeams(body.ownerTeams || []);
        setEncrypted(!!body.encrypted);
        setScopedCounts(body.scopedTagCounts || {});
        setIsPublic(!!body.isPublic);
        setState(body.ownerTeams && body.ownerTeams.length > 0 ? 'ready' : 'empty');
      } catch {
        if (cancelled) return;
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [replaySlug, installToken]);

  // Keep the parent's `armedTeams` in sync with the live shared set — on the
  // initial load and after each optimistic toggle (incl. a failed-toggle
  // revert, which mutates `shares`). Only fires once data has loaded so we
  // don't clobber the parent's GET /tags snapshot with an empty set mid-fetch.
  // `onArmedTeamsChange` is the parent's stable setState, so [shares, teams,
  // state] are the only triggers — no render loop.
  useEffect(() => {
    if (state !== 'ready' && state !== 'empty') return;
    onArmedTeamsChange?.(teams.filter((t) => shares.has(t.slug)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shares, teams, state]);

  // Toggle entry point: turning a team OFF that has comments scoped to it
  // first asks for confirmation (the un-share strips those comments from the
  // team). Everything else applies immediately.
  const requestToggle = (teamSlug: string) => {
    if (pending.has(teamSlug)) return;
    const wasShared = shares.has(teamSlug);
    const affected = scopedCounts[teamSlug] ?? 0;
    if (wasShared && affected > 0) {
      const t = teams.find((x) => x.slug === teamSlug);
      setConfirm({ slug: teamSlug, name: t?.name ?? teamSlug, count: affected });
      return;
    }
    applyToggle(teamSlug);
  };

  const applyToggle = async (teamSlug: string) => {
    if (pending.has(teamSlug)) return;
    const wasShared = shares.has(teamSlug);
    // Optimistic update — revert on failure.
    setShares((prev) => {
      const next = new Set(prev);
      if (wasShared) next.delete(teamSlug);
      else next.add(teamSlug);
      return next;
    });
    setPending((prev) => new Set(prev).add(teamSlug));
    try {
      const res = await fetch(`/api/replays/${replaySlug}/team-shares`, {
        method: wasShared ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ teamSlug }),
      });
      const body = await res.json();
      if (!body.ok) {
        // Revert.
        setShares((prev) => {
          const next = new Set(prev);
          if (wasShared) next.add(teamSlug);
          else next.delete(teamSlug);
          return next;
        });
      } else if (wasShared) {
        // Un-share succeeded: the server stripped this team from the replay's
        // tag scopes, so nothing more is scoped to it. B135: the share row
        // (which carried the review flag) is gone too.
        setScopedCounts((prev) => ({ ...prev, [teamSlug]: 0 }));
        setReviewTeams((prev) => { const next = new Set(prev); next.delete(teamSlug); return next; });
      }
    } catch {
      setShares((prev) => {
        const next = new Set(prev);
        if (wasShared) next.add(teamSlug);
        else next.delete(teamSlug);
        return next;
      });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(teamSlug);
        return next;
      });
    }
  };

  // B133: publish / unpublish. Optimistic with revert, mirroring the team
  // toggles.
  const togglePublic = async () => {
    if (publicPending) return;
    const was = isPublic;
    setIsPublic(!was);
    setPublicPending(true);
    try {
      const res = await fetch(`/api/replays/${replaySlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ public: !was }),
      });
      const body = await res.json();
      if (!body.ok) setIsPublic(was);
    } catch {
      setIsPublic(was);
    } finally {
      setPublicPending(false);
    }
  };

  // B135: request / un-request team review for a SHARED team (optimistic).
  const toggleReview = async (teamSlug: string) => {
    if (reviewPending.has(teamSlug)) return;
    const was = reviewTeams.has(teamSlug);
    setReviewTeams((prev) => { const next = new Set(prev); if (was) next.delete(teamSlug); else next.add(teamSlug); return next; });
    setReviewPending((prev) => new Set(prev).add(teamSlug));
    try {
      const res = await fetch(`/api/replays/${replaySlug}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ teamSlug, requested: !was }),
      });
      const body = await res.json();
      if (!body.ok) setReviewTeams((prev) => { const next = new Set(prev); if (was) next.add(teamSlug); else next.delete(teamSlug); return next; });
    } catch {
      setReviewTeams((prev) => { const next = new Set(prev); if (was) next.add(teamSlug); else next.delete(teamSlug); return next; });
    } finally {
      setReviewPending((prev) => { const next = new Set(prev); next.delete(teamSlug); return next; });
    }
  };

  if (state === 'loading' || state === 'unauth') return null;
  if (state === 'error') {
    return <div style={{ fontSize: 11, color: '#ff7a7a', fontStyle: 'italic' }}>Couldn&apos;t load team shares.</div>;
  }

  // B133: the Public section renders for owners with zero teams too — public
  // sharing doesn't require team membership.
  const publicSection = (
    <PublicShareSection checked={isPublic} onChange={togglePublic} disabled={publicPending} />
  );

  if (state === 'empty') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {publicSection}
        <div style={{ fontSize: 11, color: '#6c7588', fontStyle: 'italic' }}>
          You&apos;re not in any teams yet. Create or join one at{' '}
          <a href="/teams" style={{ color: '#5db4ff' }}>/teams</a>.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={shareSectionLabel}>Share with team</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {teams.map((t) => {
          const isShared = shares.has(t.slug);
          const isPending = pending.has(t.slug);
          // B170/ADR 0010: can't NEWLY share into this team (plaintext → private, or
          // encrypted → non-private). A blocked team is never already shared, so
          // unshare still works.
          const blocked = t.shareable === false && !isShared;
          const blockReason = t.privateMode
            ? '🔒 This replay was uploaded without encryption, so it can’t be added to this private team.'
            : 'This encrypted replay can only be shared with its private team.';
          return (
            <TeamShareRow
              key={t.slug}
              label={t.name}
              checked={isShared}
              disabled={isPending || blocked}
              onToggle={() => { if (!blocked) requestToggle(t.slug); }}
              note={blocked ? <ToggleNote>{blockReason}</ToggleNote> : null}
              review={isShared ? (
                <ReviewStar
                  on={reviewTeams.has(t.slug)}
                  onToggle={() => toggleReview(t.slug)}
                  disabled={reviewPending.has(t.slug)}
                  labelOn="In review queue — click to remove"
                  labelOff="Request team review"
                  testId={`request-review-${t.slug}`}
                />
              ) : null}
            />
          );
        })}
      </div>
      <div style={{ borderTop: '1px solid #2e333c', paddingTop: 8, marginTop: 2 }}>
        {publicSection}
      </div>
      {confirm && (
        <ConfirmDialog
          open
          title={`Un-share from ${confirm.name}?`}
          message={
            `This removes the replay from ${confirm.name}'s browser. ${confirm.count} ${confirm.count === 1 ? 'comment is' : 'comments are'} scoped to ` +
            `${confirm.name} and will be untagged from the team — they stay on the replay but ` +
            `won't appear in ${confirm.name}'s discussion anymore.`
          }
          confirmLabel="Un-share"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const slug = confirm.slug; setConfirm(null); applyToggle(slug); }}
        />
      )}
    </div>
  );
}
