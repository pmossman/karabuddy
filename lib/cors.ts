// CORS helper for API routes. The extension at karabast.net (and the
// chrome-extension:// pages) POSTs into our API cross-origin. We allow
// karabast.net + any chrome-extension origin by default; tighten later if
// abuse demands per-extension-id pinning.

const ALLOWED_ORIGINS = new Set([
  'https://karabast.net',
  'https://www.karabast.net',
  'http://localhost:3000',
]);

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Install-Token',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith('chrome-extension://'))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

export function preflight(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  });
}
