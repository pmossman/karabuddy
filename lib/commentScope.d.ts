// Types for the shared plain-JS commentScope module. Co-located .d.ts so
// the TS app gets precise types while the extension consumes the raw .js.
export function scopeFromMentions(input: {
  armedTeams: string[];
  mentionedUserIds: string[];
  memberTeams: Record<string, string[]>;
}): string[];

export function scopeLabel(
  scope: string[],
  armedTeams: string[],
  teamNames: Record<string, string>,
): string;
