import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendDM, postToChannel, postWebhook } from '@/lib/discord';

// B190 safety invariant: with the bot token present (as it is locally — .env.local
// is the prod snapshot source), outbound Discord must NOT fire unless we're a real
// production deploy or explicitly opted in. Guards localhost/preview/CI from ever
// pinging the live server. We stub global.fetch so any send is observable.
const ORIG = {
  token: process.env.DISCORD_BOT_TOKEN,
  vercelEnv: process.env.VERCEL_ENV,
  allow: process.env.KARABUDDY_DISCORD_ALLOW,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Token present = "configured", so the only thing standing between us and a
  // real send is the environment gate.
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  delete process.env.VERCEL_ENV;
  delete process.env.KARABUDDY_DISCORD_ALLOW;
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.DISCORD_BOT_TOKEN = ORIG.token;
  if (ORIG.vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIG.vercelEnv;
  if (ORIG.allow === undefined) delete process.env.KARABUDDY_DISCORD_ALLOW;
  else process.env.KARABUDDY_DISCORD_ALLOW = ORIG.allow;
});

describe('Discord sends are gated to real production', () => {
  it('skips DM + channel + webhook when VERCEL_ENV is unset (localhost)', async () => {
    expect(await sendDM('disc_123', 'hi')).toMatchObject({ skipped: true });
    expect(await postToChannel('chan_1', 'hi')).toMatchObject({ skipped: true });
    expect(await postWebhook('https://discord.com/api/webhooks/x', 'hi')).toMatchObject({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips on preview deploys (VERCEL_ENV=preview)', async () => {
    process.env.VERCEL_ENV = 'preview';
    expect(await postToChannel('chan_1', 'hi')).toMatchObject({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends on a real production deploy (VERCEL_ENV=production)', async () => {
    process.env.VERCEL_ENV = 'production';
    const res = await postToChannel('chan_1', 'hi');
    expect(res.skipped).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends when explicitly opted in via KARABUDDY_DISCORD_ALLOW=1', async () => {
    process.env.KARABUDDY_DISCORD_ALLOW = '1';
    await postToChannel('chan_1', 'hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
