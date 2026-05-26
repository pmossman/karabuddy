// Each browser/extension install carries an opaque installToken — it's how
// we attribute uploads and tag authorship without forcing a login. Stored
// in localStorage; sent to the API via header or body field.

const KEY = 'karabuddy:installToken';

export function getOrCreateInstallToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    const fresh = 'kb_' + crypto.randomUUID();
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // localStorage blocked (private mode, etc) — give a session-scoped id.
    return 'kb_ephemeral_' + crypto.randomUUID();
  }
}

const AUTHOR_KEY = 'karabuddy:authorName';

export function getOrCreateAuthorName(suggested?: string): string {
  if (typeof window === 'undefined') return suggested || 'anon';
  try {
    if (suggested) {
      window.localStorage.setItem(AUTHOR_KEY, suggested);
      return suggested;
    }
    const stored = window.localStorage.getItem(AUTHOR_KEY);
    if (stored) return stored;
    const fresh = 'anon-' + Math.random().toString(36).slice(2, 6);
    window.localStorage.setItem(AUTHOR_KEY, fresh);
    return fresh;
  } catch {
    return suggested || 'anon';
  }
}
