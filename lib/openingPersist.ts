// B221: materialize a replay's OPENING facts (lib/openingExtract) into
// Postgres. Called from the upload path via the persistStatsSafe posture
// (guarded — must never fail an upload) + the backfill script. Upsert on
// replaySlug: a re-upload (or an extractor-version bump re-run) is a clean
// refresh, never a duplicate. Encrypted payloads never reach here — the
// caller can't decode them (ADR 0010).

import { getDb } from './db';
import { replayOpenings } from './schema';
import { extractOpening, OPENING_EXTRACTOR_VERSION } from './openingExtract';
import type { DecodedReplay } from './replayDecoder';

export async function persistOpening(
  decoded: Pick<DecodedReplay, 'frames' | 'meta'>,
  replaySlug: string,
): Promise<boolean> {
  const facts = extractOpening(decoded);
  if (!facts) return false; // no usable setup — not an error, just no opening
  const row = {
    replaySlug,
    recorderId: facts.recorderId,
    decision: facts.decision,
    dealtHand: facts.dealtHand,
    keptHand: facts.keptHand,
    resourced: facts.resourced,
    mulliganFrameIndex: facts.mulliganFrameIndex,
    resourceFrameIndex: facts.resourceFrameIndex,
    wentFirst: facts.wentFirst,
    extractorVersion: OPENING_EXTRACTOR_VERSION,
  };
  await getDb()
    .insert(replayOpenings)
    .values(row)
    .onConflictDoUpdate({ target: replayOpenings.replaySlug, set: row });
  return true;
}
