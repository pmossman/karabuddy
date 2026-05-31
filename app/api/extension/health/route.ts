import { NextResponse } from 'next/server';
import { corsHeaders, preflight } from '@/lib/cors';
import { knownIssueCodes } from '@/lib/karabastShape';
import { postWebhook } from '@/lib/discord';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// POST /api/extension/health  body: { version?: string, issues: string[] }
//
// B80: the in-extension karabast-drift beacon. Fired ONLY when the extension
// detects structural drift in karabast's live gamestate (silent otherwise),
// and content-free by construction: `issues` is filtered to the fixed
// knownIssueCodes() enum, so nothing but predefined structural-check codes +
// a version string can land here — no game data, usernames, or card ids.
//
// A spike of the same code across many installs on the current karabast =
// upstream drift. v1 records via structured logs (greppable in Vercel logs;
// set a log-based alert). A table + push alert is the next step.
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  try {
    const body = await req.json().catch(() => ({}));
    const known = new Set(knownIssueCodes());
    // Drop anything not in the fixed enum — the privacy guarantee.
    const issues = Array.isArray(body.issues)
      ? Array.from(new Set(body.issues.filter((c: unknown) => typeof c === 'string' && known.has(c)))).slice(0, 20)
      : [];
    const version = typeof body.version === 'string' ? body.version.slice(0, 32) : 'unknown';
    if (issues.length === 0) {
      // Nothing recognized → ignore (don't log noise / can't leak content).
      return NextResponse.json({ ok: true, recorded: false }, { headers });
    }
    // Structured, content-free log line — aggregate by (version, code).
    console.warn(`[karabuddy] EXT-DRIFT ${JSON.stringify({ version, issues })}`);
    // B81: also ping the alerts channel (no-op until DISCORD_ALERTS_WEBHOOK_URL
    // is set). Content-free — same codes + version.
    await postWebhook(
      process.env.DISCORD_ALERTS_WEBHOOK_URL,
      `⚠️ **karabast drift** — ext \`${version}\` reported: ${issues.map((c) => `\`${c}\``).join(', ')}`,
    );
    return NextResponse.json({ ok: true, recorded: true }, { headers });
  } catch (err: any) {
    console.error('[karabuddy] POST /api/extension/health failed:', err);
    return NextResponse.json({ ok: false, error: err?.message || 'internal error' }, { status: 500, headers });
  }
}
