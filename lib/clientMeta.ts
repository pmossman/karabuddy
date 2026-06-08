// B114: server-side sanitizer for the client/recorder metadata the extension's
// service worker attaches to an upload envelope ({ extVersion, extVersionName,
// browser, ua }). It's untrusted input from the extension, so we whitelist a
// fixed set of string fields and length-cap each — never storing arbitrary keys
// or unbounded strings. Returns a clean object, or null if nothing usable (web
// uploads + pre-B114 extensions send no clientMeta).
const FIELDS: Record<string, number> = {
  extVersion: 32,      // manifest "version" — e.g. "0.5.10"
  extVersionName: 64,  // manifest "version_name"
  browser: 32,         // coarse: "chrome" | "firefox" | "edge" | "other"
  ua: 256,             // raw navigator.userAgent (capped)
};

export type ClientMeta = Record<string, string>;

export function sanitizeClientMeta(raw: unknown): ClientMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: ClientMeta = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, max);
  }
  return Object.keys(out).length ? out : null;
}
