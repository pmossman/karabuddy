import type { TeamRef } from '@/lib/activeTeam';
import { FORGE_ANNOUNCEMENT_VERSION } from './constants';

export interface ForgeTeamContext {
  signedIn: boolean;
  ownedTeams: TeamRef[];
  memberTeamCount: number;
  canMove: boolean;
}

export const DISMISSAL_KEY_PREFIX = 'kb:announcement:swu-forge:';

export function dismissalKey(userId: string | null, version: number = FORGE_ANNOUNCEMENT_VERSION): string {
  return `${DISMISSAL_KEY_PREFIX}v${version}:${userId ?? 'signed-out'}`;
}

export function shouldAutoOpen({ signedIn, dismissed }: { signedIn: boolean; dismissed: boolean }): boolean {
  return signedIn && !dismissed;
}

export function showMoveSection(t: ForgeTeamContext): boolean {
  if (!t.canMove) return false;
  if (!t.signedIn) return true;
  return t.ownedTeams.length > 0 || t.memberTeamCount > 0;
}
