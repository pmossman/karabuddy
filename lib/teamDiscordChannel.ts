// B144: resolve which Discord channel a team's posts for a given FEATURE go to.
// A team has a main channel plus optional per-feature overrides (review,
// tournament). The override wins; else the main channel; else null (no posting).
// Kept out of lib/discord.ts so that file stays a pure REST layer (no DB).
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import { teams } from './schema';

export type DiscordFeature = 'review' | 'tournament';

export async function teamChannelFor(teamSlug: string, feature: DiscordFeature): Promise<string | null> {
  const [row] = await getDb()
    .select({
      main: teams.discordChannelId,
      review: teams.discordReviewChannelId,
      tournament: teams.discordTournamentChannelId,
    })
    .from(teams)
    .where(eq(teams.slug, teamSlug))
    .limit(1);
  if (!row) return null;
  const override = feature === 'review' ? row.review : row.tournament;
  return override ?? row.main ?? null;
}
