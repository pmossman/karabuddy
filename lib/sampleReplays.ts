// B107: curated sample replays shown to signed-out visitors on the home page so
// they can see what KaraBuddy captures before installing anything. These are
// surfaced publicly and ANONYMIZED on display (see lib/anonymizeReplay) — real
// karabast handles become "Player 1" / "Player 2" everywhere.
//
// To feature replays, either edit SAMPLE_SLUGS below or set the
// KARABUDDY_SAMPLE_REPLAY_SLUGS env var (comma-separated slugs). The env wins
// when present, so prod can be re-curated without a code change.
const SAMPLE_SLUGS: string[] = [
  'r_4gkpv9',
];

export function getSampleReplaySlugs(): string[] {
  const env = process.env.KARABUDDY_SAMPLE_REPLAY_SLUGS;
  const list = env
    ? env.split(',').map((s) => s.trim()).filter(Boolean)
    : SAMPLE_SLUGS;
  // De-dupe while preserving curated order.
  return Array.from(new Set(list));
}

export function isSampleReplaySlug(slug: string): boolean {
  return getSampleReplaySlugs().includes(slug);
}
