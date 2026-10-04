import type { TeamRef } from '@/lib/activeTeam';
import { FORGE_ANNOUNCEMENT_VERSION } from './constants';

export interface ForgeTeamContext {
  signedIn: boolean;
  ownedTeams: TeamRef[];
  memberTeamCount: number;
  canMove: boolean;
}

export function isDismissed(dismissedVersion: number | null, version: number = FORGE_ANNOUNCEMENT_VERSION): boolean {
  return dismissedVersion !== null && dismissedVersion >= version;
}

export function shouldAutoOpen({
  signedIn,
  dismissed,
  pathname,
  search,
}: {
  signedIn: boolean;
  dismissed: boolean;
  pathname: string;
  search: string;
}): boolean {
  if (!signedIn || dismissed) return false;
  // The replay and clip viewers grab Space and the arrow keys at window level,
  // and the extension's sign-in popup closes itself straight away.
  if (/^\/[rc]\//.test(pathname)) return false;
  return new URLSearchParams(search).get('fromExtension') !== '1';
}

export function showMoveSection(t: ForgeTeamContext): boolean {
  if (!t.canMove) return false;
  if (!t.signedIn) return true;
  return t.ownedTeams.length > 0 || t.memberTeamCount > 0;
}

export function requestedMoveTeam(t: ForgeTeamContext, requested: string | string[] | undefined): TeamRef | null {
  if (!showMoveSection(t) || typeof requested !== 'string') return null;
  return t.ownedTeams.find((team) => team.slug === requested) ?? null;
}
