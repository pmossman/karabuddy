import { NextResponse } from 'next/server';
import { corsHeaders, preflight } from '@/lib/cors';
import { currentExtensionPolicy, evaluateExtensionStatus } from '@/lib/extensionPolicy';

export const runtime = 'nodejs';

export function OPTIONS(req: Request) {
  return preflight(req);
}

// GET /api/extension/status?v=<manifestVersion>
// B72: the extension SW pings this on startup to learn whether it's ok /
// should nag the user to update / is blocked (break-glass). CORS-open since
// the extension calls it cross-origin. Lenient by default — an unknown
// version returns ok (see lib/extensionPolicy).
export function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'));
  const version = new URL(req.url).searchParams.get('v') || undefined;
  const status = evaluateExtensionStatus(version, currentExtensionPolicy());
  return NextResponse.json(
    {
      ok: true,
      ...status,
      // Forward-compat: server-supported capabilities the extension can
      // feature-detect against, rather than gating purely on version.
      capabilities: ['teamScopedComments'],
    },
    { headers },
  );
}
