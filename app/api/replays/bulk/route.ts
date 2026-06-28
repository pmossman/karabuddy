import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/lib/db';
import { replays, replayTeamShares, teamMembers, teams, tags, tagTeamScope } from '@/lib/schema';
import { authContextFromRequest, canMutateReplay } from '@/lib/replayPermissions';
import { shareAllowed } from '@/lib/privateTeams';
import { revalidateForOps } from '@/lib/cached';

export const runtime = 'nodejs';

// POST /api/replays/bulk — apply ONE individual-level operation to a SET of
// replays. Every op re-runs the SAME per-item permission check the single-item
// route enforces (`canMutateReplay` — session userId OR matching install token),
// so bulk can never do what one-at-a-time couldn't: items the caller can't mutate
// come back `forbidden`, missing slugs `notFound`, and items the op can't apply to
// (encrypted→public, plaintext→private team) `skipped`. Partial success is normal.
//
//   body: { op, slugs: string[], teamSlug? }
//   op:   delete | publish | unpublish | share | unshare
//
// share/unshare carry a teamSlug; share additionally requires a session AND that
// the caller is a member of the team (mirrors the single team-shares route), and
// preserves its side effects (private-team compat per replay; unshare strips that
// team from every tag's scope to keep audience ⊆ shares).

const OPS = new Set(['delete', 'publish', 'unpublish', 'share', 'unshare', 'label-add', 'label-remove', 'review-request', 'review-cancel']);
const TEAM_OPS = new Set(['share', 'unshare', 'review-request', 'review-cancel']); // carry a teamSlug
const LABEL_OPS = new Set(['label-add', 'label-remove']); // carry a label
const MAX_SLUGS = 1000;

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

// Same normalization the single PATCH route applies to labels: trim, slice 40,
// drop empties, dedupe case-insensitively (first casing wins), cap 20.
function cleanLabels(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const s = String(raw || '').trim().slice(0, 40);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= 20) break;
  }
  return out;
}

export async function POST(req: Request) {
  const session = await auth();
  const userId: string | null = session?.user?.id || null;
  const ctx = authContextFromRequest(req, userId);

  const body = await req.json().catch(() => ({}));
  const op = String(body.op || '');
  if (!OPS.has(op)) return bad(400, 'unknown op');

  const rawSlugs: unknown[] = Array.isArray(body.slugs) ? body.slugs : [];
  const slugs: string[] = [...new Set(rawSlugs.map((s) => String(s)).filter((s) => s.length > 0))].slice(0, MAX_SLUGS);
  if (slugs.length === 0) return bad(400, 'no slugs');

  const needsTeam = TEAM_OPS.has(op);
  const teamSlug = needsTeam ? String(body.teamSlug || '').trim() : '';
  if (needsTeam && !teamSlug) return bad(400, 'teamSlug required');
  const label = LABEL_OPS.has(op) ? String(body.label || '').trim().slice(0, 40) : '';
  if (LABEL_OPS.has(op) && !label) return bad(400, 'label required');
  if (op === 'share' && !userId) return bad(401, 'sign in required to share with teams');

  const db = getDb();

  // Share gate (once for the whole batch): the caller must belong to the target
  // team, else a slug alone could pollute its grid. Pull privacy state for the
  // per-replay shareAllowed check below.
  let team: { privateMode: boolean; teamKeyId: string | null } | null = null;
  if (op === 'share') {
    const [m] = await db
      .select({ privateMode: teams.privateMode, teamKeyId: teams.teamKeyId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.slug, teamMembers.teamSlug))
      .where(and(eq(teamMembers.teamSlug, teamSlug), eq(teamMembers.userId, userId!)))
      .limit(1);
    if (!m) return bad(403, 'not a member of that team');
    team = m;
  }

  // Review flags live on the share row → the replay must already be shared with
  // the team. Precompute which of the selected slugs are (the rest skip).
  let reviewShared: Set<string> | null = null;
  if (op === 'review-request' || op === 'review-cancel') {
    const shareRows = await db
      .select({ replaySlug: replayTeamShares.replaySlug })
      .from(replayTeamShares)
      .where(and(inArray(replayTeamShares.replaySlug, slugs), eq(replayTeamShares.teamSlug, teamSlug)));
    reviewShared = new Set(shareRows.map((s) => s.replaySlug));
  }

  const rows = await db.select().from(replays).where(inArray(replays.slug, slugs));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));

  const results = { ok: [] as string[], forbidden: [] as string[], notFound: [] as string[], skipped: [] as string[] };
  const apply: string[] = []; // passed every check → gets the batched DB write
  for (const slug of slugs) {
    const replay = bySlug.get(slug);
    if (!replay) { results.notFound.push(slug); continue; }
    if (!canMutateReplay(replay, ctx)) { results.forbidden.push(slug); continue; }
    // Encrypted replays can never be public (would expose ciphertext on a
    // stranger-facing surface) — mirror the single PATCH route's rejection.
    if (op === 'publish' && replay.encrypted) { results.skipped.push(slug); continue; }
    // Encrypted replays keep title/labels in the E2EE summary — a plaintext label
    // edit would leak them, so the PATCH route rejects it. Skip them here too.
    if (LABEL_OPS.has(op) && replay.encrypted) { results.skipped.push(slug); continue; }
    if (op === 'share' && !shareAllowed({ encrypted: replay.encrypted, replayTeamKeyId: replay.teamKeyId, team: { privateMode: team!.privateMode, teamKeyId: team!.teamKeyId } }).ok) {
      results.skipped.push(slug);
      continue;
    }
    // Review flags require the replay to already be shared with the team.
    if ((op === 'review-request' || op === 'review-cancel') && !reviewShared!.has(slug)) { results.skipped.push(slug); continue; }
    apply.push(slug);
  }

  if (apply.length > 0) {
    if (op === 'delete') {
      await db.delete(replays).where(inArray(replays.slug, apply)); // cascades to tags/shares via FK
    } else if (op === 'unpublish') {
      await db.update(replays).set({ publicAt: null }).where(inArray(replays.slug, apply));
    } else if (op === 'publish') {
      // Idempotent: only stamp rows not already public, so re-publishing keeps
      // the original publicAt the public browser sorts by.
      const toStamp = apply.filter((s) => !bySlug.get(s)!.publicAt);
      if (toStamp.length) await db.update(replays).set({ publicAt: new Date() }).where(inArray(replays.slug, toStamp));
    } else if (op === 'share') {
      await db.insert(replayTeamShares).values(apply.map((s) => ({ replaySlug: s, teamSlug, sharedBy: userId! }))).onConflictDoNothing();
    } else if (op === 'unshare') {
      await db.delete(replayTeamShares).where(and(inArray(replayTeamShares.replaySlug, apply), eq(replayTeamShares.teamSlug, teamSlug)));
      // Strip the team from every tag on these replays — without it the replay
      // would still surface via a scoped tag and break the audience ⊆ shares rule.
      const tagIds = (await db.select({ id: tags.id }).from(tags).where(inArray(tags.replaySlug, apply))).map((t) => t.id);
      if (tagIds.length) await db.delete(tagTeamScope).where(and(eq(tagTeamScope.teamSlug, teamSlug), inArray(tagTeamScope.tagId, tagIds)));
    } else if (op === 'label-add' || op === 'label-remove') {
      // Read-modify-write per row (each keeps its own label set), reusing the
      // single route's normalization. A no-op (already has / lacks the label)
      // still counts as applied — the op is idempotent.
      for (const slug of apply) {
        const existing = (bySlug.get(slug)!.labels as string[] | null) ?? [];
        const next = op === 'label-add'
          ? cleanLabels([...existing, label])
          : cleanLabels(existing.filter((l) => l.toLowerCase() !== label.toLowerCase()));
        await db.update(replays).set({ labels: next.length ? next : null }).where(eq(replays.slug, slug));
      }
    } else if (op === 'review-request' || op === 'review-cancel') {
      // Bulk: set/clear the request flag on the share rows. We deliberately do NOT
      // fire the per-replay Discord notify here (it would spam the team channel);
      // the single-replay route still notifies.
      const requested = op === 'review-request';
      await db.update(replayTeamShares)
        .set({ reviewRequestedAt: requested ? new Date() : null, reviewRequestedBy: requested ? userId : null })
        .where(and(inArray(replayTeamShares.replaySlug, apply), eq(replayTeamShares.teamSlug, teamSlug)));
    }
    results.ok.push(...apply);
    // Bust the caches this op can stale (team dashboard / public browser / stats)
    // so the change shows immediately instead of after the read TTL.
    revalidateForOps([op]);
  }

  return NextResponse.json({ ok: true, op, applied: results.ok.length, results });
}
