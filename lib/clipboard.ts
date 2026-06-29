// B203: clipboard copy with a non-secure-context fallback. Was defined inside
// the MatchupInfo client component (B196); lifted to lib/ so every caller (the
// viewer share-moment, share-tag, clip + tournament copy buttons) shares one
// robust implementation instead of a bare `navigator.clipboard.writeText`.
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
}
