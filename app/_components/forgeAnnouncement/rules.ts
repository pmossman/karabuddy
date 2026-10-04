import type { MyTeamRef, TeamRef } from '@/lib/activeTeam';
import { FORGE_ANNOUNCEMENT_VERSION } from './constants';

export interface OwnedTeam extends TeamRef {
  movedOn: string | null;
}

export interface MovedTeam extends TeamRef {
  url: string;
  movedOn: string;
}

export interface ForgeTeamContext {
  signedIn: boolean;
  ownedTeams: OwnedTeam[];
  memberTeamCount: number;
  movedMemberTeams: MovedTeam[];
  canMove: boolean;
}

const movedDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function formatMovedOn(movedAt: Date): string {
  return movedDate.format(movedAt);
}

export function movedTeam(team: TeamRef & { forgeTeamUrl: string | null; forgeMovedAt: Date | null }): MovedTeam | null {
  if (!team.forgeTeamUrl || !team.forgeMovedAt) return null;
  return { slug: team.slug, name: team.name, url: team.forgeTeamUrl, movedOn: formatMovedOn(team.forgeMovedAt) };
}

export function forgeTeamContext(signedIn: boolean, teams: MyTeamRef[], canMove: boolean): ForgeTeamContext {
  const owned = teams.filter((t) => t.role === 'owner');
  return {
    signedIn,
    ownedTeams: owned.map((t) => ({ slug: t.slug, name: t.name, movedOn: movedTeam(t)?.movedOn ?? null })),
    memberTeamCount: teams.length - owned.length,
    movedMemberTeams: teams.flatMap((t) => {
      const moved = t.role === 'owner' ? null : movedTeam(t);
      return moved ? [moved] : [];
    }),
    canMove,
  };
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

export function requestedMoveTeam(t: ForgeTeamContext, requested: string | string[] | undefined): OwnedTeam | null {
  if (!showMoveSection(t) || typeof requested !== 'string') return null;
  return t.ownedTeams.find((team) => team.slug === requested) ?? null;
}
