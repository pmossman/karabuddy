// Bump to show the announcement again to everyone who dismissed this one.
export const FORGE_ANNOUNCEMENT_VERSION = 1;

export const SWU_FORGE_URL = 'https://swuforge.com';
export const SWU_FORGE_DOCS_URL = 'https://swu-forge.gitbook.io/docs';
export const KARABUDDY_DISCORD_URL = 'https://discord.gg/DnbpNa6yzv';
export const SWU_FORGE_DISCORD_URL = 'https://discord.gg/4zqR5g9dvt';
export const HUB_PATH = '/swu-forge';

export function hubMovePath(teamSlug: string): string {
  return `${HUB_PATH}?team=${encodeURIComponent(teamSlug)}`;
}
