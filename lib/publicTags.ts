// B133: redact a public replay's tag comments for NON-entitled viewers.
// The owner vetted the comments and chose to publish them — but the people
// who wrote them (and anyone they @-mentioned) didn't choose to be named on
// a public page. So the wire rows a stranger receives are stripped:
//
//   • author identity → a stable alias. An author whose name matches one of
//     the replay's (owner-first ordered) players gets that player's anon
//     label ("Player1"/"Player2" — same labels the anonymized board shows,
//     so "the player themselves commented" reads correctly and tag colors
//     line up). Everyone else becomes "Reviewer 1", "Reviewer 2", … in
//     first-appearance order.
//   • @-mentions → redacted out of the comment TEXT (structural names first
//     — the mentioned users/teams we know about — then a generic @token
//     sweep as a privacy-first fallback), and the structured `mentions`
//     field is dropped entirely.
//   • userId / authorToken / scope → never sent (no correlation handles).
//
// Pure: callers resolve mentioned-user names / team names and pass them in.

import { anonLabel } from './anonymizeReplay';
import { normalizeMentions } from './mentions';

export interface PublicTagWireRow {
  id: string;
  replaySlug: string;
  frameIndex: number;
  comment: string;
  authorName: string;
  parentTagId: string | null;
  createdAt: string;
  // Constant shells so the existing viewer components render without edit /
  // scope affordances.
  userId: null;
  authorToken: '';
  mentions: null;
  scope: [];
}

interface TagRowIn {
  id: string;
  replaySlug: string;
  frameIndex: number;
  comment: string;
  authorName: string;
  userId: string | null;
  authorToken: string;
  parentTagId?: string | null;
  mentions?: unknown;
  createdAt: Date | string;
}

const REDACTED = '@[redacted]';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactMentionText(
  comment: string,
  knownNames: string[],
  knownTeamSlugs: string[],
): string {
  let out = comment;
  // Structural pass: the names we KNOW were mentioned (handles multi-word
  // display names the generic sweep can't see past the first token).
  for (const name of knownNames) {
    if (!name) continue;
    out = out.replace(new RegExp(`@${escapeRe(name)}`, 'gi'), REDACTED);
  }
  for (const slug of knownTeamSlugs) {
    if (!slug) continue;
    out = out.replace(new RegExp(`@team:${escapeRe(slug)}`, 'gi'), REDACTED);
  }
  // Generic sweep: any remaining @token (free-typed mentions never resolved
  // structurally). Privacy-first — over-redacting a stray "@" beats leaking
  // a handle. Skips tokens we already redacted.
  out = out.replace(/@team:[\w-]+/g, REDACTED);
  out = out.replace(/@(?!\[redacted\])[A-Za-z0-9_.-]+/g, REDACTED);
  return out;
}

export function redactPublicTags(
  rows: TagRowIn[],
  ownerFirstPlayers: Array<{ username?: string | null }>,
  resolved: { userNamesById: Map<string, string>; teamNamesBySlug: Map<string, string> },
): PublicTagWireRow[] {
  // Player aliases by username (the anonymized board's labels, same order).
  const playerAlias = new Map<string, string>();
  ownerFirstPlayers.forEach((p, i) => {
    const u = (p?.username || '').toLowerCase();
    if (u) playerAlias.set(u, anonLabel(i));
  });

  // Reviewer aliases: stable by author identity, first-appearance order.
  const reviewerAlias = new Map<string, string>();
  const aliasFor = (t: TagRowIn): string => {
    const fromPlayer = playerAlias.get((t.authorName || '').toLowerCase());
    if (fromPlayer) return fromPlayer;
    const key = t.userId ?? t.authorToken;
    let alias = reviewerAlias.get(key);
    if (!alias) {
      alias = `Reviewer ${reviewerAlias.size + 1}`;
      reviewerAlias.set(key, alias);
    }
    return alias;
  };

  const sorted = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const out = new Map<string, PublicTagWireRow>();
  for (const t of sorted) {
    const m = normalizeMentions(t.mentions);
    const names = m.userIds.map((id) => resolved.userNamesById.get(id) || '').filter(Boolean);
    const teamNames = m.teamSlugs.map((s) => resolved.teamNamesBySlug.get(s) || '').filter(Boolean);
    out.set(t.id, {
      id: t.id,
      replaySlug: t.replaySlug,
      frameIndex: t.frameIndex,
      comment: redactMentionText(t.comment, [...names, ...teamNames], m.teamSlugs),
      authorName: aliasFor(t),
      parentTagId: t.parentTagId ?? null,
      createdAt: new Date(t.createdAt).toISOString(),
      userId: null,
      authorToken: '',
      mentions: null,
      scope: [],
    });
  }
  // Original row order (frameIndex asc from the route's query).
  return rows.map((r) => out.get(r.id)!);
}
