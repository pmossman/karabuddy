'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// B66c: replay labels surfaced as a row of pills + a small "+" button
// to add new ones. Each pill has a × to remove. The + button opens a
// text input wired to a `<datalist>` of suggestions pulled from
// /api/me/labels (user's + team's existing labels), so picking a
// commonly-used label is one keystroke + Tab instead of re-typing.
export function LabelsRow({
  replaySlug,
  installToken,
  initialLabels,
  canEdit,
}: {
  replaySlug: string;
  installToken: string;
  initialLabels: string[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [labels, setLabels] = useState<string[]>(initialLabels);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suggestionsLoadedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  // Re-sync from the prop when the replay's labels actually change. The caller
  // passes a fresh array each render, so guard on CONTENT (via a ref) and only
  // call setLabels on a real change — otherwise this loops under rapid parent
  // re-renders (holding the step arrow): setState → render → new array → …
  const syncedRef = useRef<string[]>(initialLabels);
  useEffect(() => {
    const a = syncedRef.current;
    if (a.length === initialLabels.length && a.every((v, i) => v === initialLabels[i])) return;
    syncedRef.current = initialLabels;
    setLabels(initialLabels);
  }, [initialLabels]);

  // Lazy-load suggestions only when the user opens the picker — saves a
  // round trip for the common case (viewing a replay without editing).
  useEffect(() => {
    if (!adding || suggestionsLoadedRef.current) return;
    suggestionsLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch('/api/me/labels');
        const body = await res.json();
        if (body.ok && Array.isArray(body.labels)) {
          // Filter out labels already on this replay — no point
          // suggesting one the user has already applied.
          const lower = new Set(labels.map((l) => l.toLowerCase()));
          setSuggestions(body.labels.filter((l: string) => !lower.has(l.toLowerCase())));
        }
      } catch {
        // Silent — the user can still type a new label freely.
      }
    })();
  }, [adding, labels]);

  const persist = async (next: string[]) => {
    setBusy(true);
    const prev = labels;
    setLabels(next); // optimistic
    try {
      const res = await fetch(`/api/replays/${replaySlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ labels: next }),
      });
      const body = await res.json();
      if (!body.ok) {
        setLabels(prev);
        alert(`Failed to save labels: ${body.error || 'unknown'}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setLabels(prev);
      alert(`Failed to save labels: ${err?.message || 'network error'}`);
    } finally {
      setBusy(false);
    }
  };

  const addLabel = async () => {
    const v = draft.trim().slice(0, 40);
    if (!v) {
      setAdding(false);
      return;
    }
    if (labels.some((l) => l.toLowerCase() === v.toLowerCase())) {
      // Already on this replay — close picker silently.
      setDraft('');
      setAdding(false);
      return;
    }
    if (labels.length >= 20) {
      alert('20 labels max per replay');
      return;
    }
    setDraft('');
    setAdding(false);
    await persist([...labels, v]);
  };

  const removeLabel = (l: string) => {
    if (!canEdit || busy) return;
    persist(labels.filter((x) => x !== l));
  };

  const startAdding = () => {
    if (!canEdit || busy) return;
    setAdding(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {labels.map((l) => (
        <span
          key={l}
          data-testid="label-pill"
          style={{
            background: 'rgba(160, 196, 255, 0.10)',
            border: '1px solid rgba(160, 196, 255, 0.3)',
            color: '#a7d2ff',
            borderRadius: 999,
            padding: '2px 4px 2px 10px',
            fontSize: 11,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
          }}
        >
          {l}
          {canEdit && (
            <button
              type="button"
              onClick={() => removeLabel(l)}
              aria-label={`Remove label ${l}`}
              style={{
                background: 'transparent',
                border: 0,
                color: '#6c7588',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: 12,
                lineHeight: 1,
                fontFamily: 'inherit',
              }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit && (adding ? (
        <>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            list={listId}
            placeholder="label…"
            maxLength={40}
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addLabel();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              // Don't blur-save if the user is clicking a datalist option
              // — the browser fires blur during option select. Tiny delay
              // lets the change event run first.
              setTimeout(() => {
                if (draft.trim()) addLabel();
                else setAdding(false);
              }, 100);
            }}
            style={{
              background: '#11141a',
              color: '#e6e6e6',
              border: '1px solid rgba(77, 157, 255, 0.5)',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 11,
              fontFamily: 'inherit',
              outline: 'none',
              width: 100,
            }}
          />
          <datalist id={listId}>
            {suggestions.map((s) => <option key={s} value={s} />)}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          onClick={startAdding}
          aria-label="Add label"
          title="Add label"
          style={{
            background: 'transparent',
            border: '1px dashed #4a4e56',
            color: '#a0a8b8',
            borderRadius: 999,
            padding: '1px 9px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            lineHeight: 1.3,
          }}
        >
          +
        </button>
      ))}
    </div>
  );
}
