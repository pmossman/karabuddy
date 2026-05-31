// B81: Discord REST primitives. Works on serverless (no gateway) — all
// outbound: DM a user, post to a channel, or POST a webhook. Bot calls use
// DISCORD_BOT_TOKEN; everything no-ops safely when the token/URL is unset
// (local dev, tests, or before the bot is configured), so callers can fire
// these unconditionally.

const DISCORD_API = 'https://discord.com/api/v10';

function botToken(): string {
  return process.env.DISCORD_BOT_TOKEN || '';
}
export function discordBotEnabled(): boolean {
  return !!botToken();
}

export interface SendResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

async function botPost(path: string, body: unknown): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// DM a user by their Discord user id. Requires the bot to share a server with
// them (Discord platform rule) — i.e. they've joined the KaraBuddy server.
export async function sendDM(discordUserId: string, content: string): Promise<SendResult> {
  if (!botToken()) return { ok: false, skipped: true };
  if (!discordUserId) return { ok: false, error: 'no discord user id' };
  try {
    const chanRes = await botPost('/users/@me/channels', { recipient_id: discordUserId });
    if (!chanRes.ok) return { ok: false, status: chanRes.status, error: 'could not open DM channel' };
    const channel = await chanRes.json();
    const msgRes = await botPost(`/channels/${channel.id}/messages`, { content });
    return { ok: msgRes.ok, status: msgRes.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'discord DM failed' };
  }
}

// Post to a specific channel via the bot (used for team-server activity once
// the bot is invited and a channel is chosen).
export async function postToChannel(channelId: string, content: string): Promise<SendResult> {
  if (!botToken()) return { ok: false, skipped: true };
  if (!channelId) return { ok: false, error: 'no channel id' };
  try {
    const res = await botPost(`/channels/${channelId}/messages`, { content });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'discord channel post failed' };
  }
}

// List a guild's text channels the bot can see — for the team owner's
// channel picker after they invite the bot. Empty on any failure.
export async function listGuildTextChannels(guildId: string): Promise<{ id: string; name: string }[]> {
  if (!botToken() || !guildId) return [];
  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken()}` },
    });
    if (!res.ok) return [];
    const channels = await res.json();
    return (Array.isArray(channels) ? channels : [])
      .filter((c: any) => c.type === 0) // 0 = GUILD_TEXT
      .map((c: any) => ({ id: String(c.id), name: String(c.name) }));
  } catch {
    return [];
  }
}

// Post to a channel webhook URL — no bot needed. Used for CI + drift/error
// pings to the KaraBuddy server (webhook URL in env/secrets).
export async function postWebhook(url: string | undefined, content: string): Promise<SendResult> {
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'discord webhook failed' };
  }
}
