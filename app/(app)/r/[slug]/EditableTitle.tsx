'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// B66c: inline-editable replay title. Display state shows the title
// text + a small pencil button. Click pencil → text becomes an input
// pre-filled with the current displayName. Enter saves, Esc cancels,
// blur also saves (catches users who tab/click away).
//
// When displayName is null, the display falls back to a caller-supplied
// `defaultText` — matches the "auto matchup" text the replay browser
// shows so the title row never reads as empty.
export function EditableTitle({
  replaySlug,
  installToken,
  initialDisplayName,
  defaultText,
  canEdit,
}: {
  replaySlug: string;
  installToken: string;
  initialDisplayName: string | null;
  defaultText: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDisplayName ?? '');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Skip the save-on-blur path when the user explicitly cancelled —
  // otherwise blur from the Esc-triggered programmatic blur would
  // overwrite-back to the just-cancelled draft.
  const cancelledRef = useRef(false);

  // Re-sync if the parent reloads with a different replay (rare but
  // happens after router.refresh()).
  useEffect(() => {
    setDisplayName(initialDisplayName);
  }, [initialDisplayName]);

  const startEdit = () => {
    if (!canEdit || busy) return;
    cancelledRef.current = false;
    setDraft(displayName ?? '');
    setEditing(true);
    // Focus on next tick so the input has mounted.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const save = async () => {
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    setBusy(true);
    setEditing(false);
    // Optimistic local update so the title doesn't flicker back to the
    // stale value before the network round-trips.
    setDisplayName(next);
    try {
      const res = await fetch(`/api/replays/${replaySlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({ displayName: next }),
      });
      const body = await res.json();
      if (!body.ok) {
        // Revert + surface the error inline (small + transient).
        setDisplayName(initialDisplayName);
        alert(`Failed to save title: ${body.error || 'unknown'}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setDisplayName(initialDisplayName);
      alert(`Failed to save title: ${err?.message || 'network error'}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    setEditing(false);
    setDraft(displayName ?? '');
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={defaultText}
        maxLength={120}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          if (cancelledRef.current) return;
          save();
        }}
        style={{
          flex: 1,
          minWidth: 0,
          background: '#11141a',
          color: '#e6e6e6',
          border: '1px solid rgba(74, 124, 255, 0.5)',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 14,
          fontWeight: 700,
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
    );
  }

  const shown = displayName || defaultText;
  return (
    <>
      <div
        title={displayName || `(default: ${defaultText})`}
        style={{
          fontSize: 14,
          color: displayName ? '#e6e6e6' : '#a0a8b8',
          fontWeight: displayName ? 700 : 600,
          lineHeight: 1.3,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {shown}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={startEdit}
          aria-label="Edit replay title"
          title="Edit title"
          style={{
            background: 'transparent',
            border: 0,
            color: '#a0a8b8',
            cursor: 'pointer',
            padding: 4,
            fontSize: 13,
            lineHeight: 1,
            fontFamily: 'inherit',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✎
        </button>
      )}
    </>
  );
}
