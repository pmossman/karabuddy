'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// B53: owner-only inline editor for display name + labels. Lives inside
// the Share popover next to the existing visibility toggle / team-share.
// Optimistic update of local form state; on success we router.refresh()
// so the next render picks up the persisted values from the page-level
// server query.
export function EditReplayMeta({
  replaySlug,
  installToken,
  initialDisplayName,
  initialLabels,
}: {
  replaySlug: string;
  installToken: string;
  initialDisplayName: string | null;
  initialLabels: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialDisplayName || '');
  const [labelDraft, setLabelDraft] = useState('');
  const [labels, setLabels] = useState<string[]>(initialLabels);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLabel = () => {
    const v = labelDraft.trim().slice(0, 40);
    if (!v) return;
    if (labels.some((l) => l.toLowerCase() === v.toLowerCase())) {
      setLabelDraft('');
      return;
    }
    if (labels.length >= 20) {
      setError('20 labels max');
      return;
    }
    setLabels([...labels, v]);
    setLabelDraft('');
    setError(null);
  };

  const removeLabel = (l: string) => {
    setLabels(labels.filter((x) => x !== l));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/replays/${replaySlug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Install-Token': installToken },
        body: JSON.stringify({
          displayName: nameDraft.trim(),
          labels,
        }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'failed to save');
        setBusy(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'network error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: '1px solid #4a4e56',
          color: '#a0a8b8',
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          alignSelf: 'flex-start',
        }}
      >
        Edit title + labels
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Display name
        </label>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="(matchup default)"
          maxLength={120}
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 10, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Labels
        </label>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => removeLabel(l)}
              style={labelChip}
            >
              {l} <span style={{ color: '#6c7588', marginLeft: 4 }}>×</span>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addLabel();
              }
            }}
            placeholder="add a label, Enter to confirm"
            maxLength={40}
            style={inputStyle}
          />
          <button type="button" onClick={addLabel} style={smallBtn}>Add</button>
        </div>
      </div>
      {error && <div style={{ fontSize: 11, color: '#ff7a7a' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          style={smallBtnGhost}
        >
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={busy} style={{ ...smallBtn, opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: '#11141a',
  color: '#e6e6e6',
  border: '1px solid #2e333c',
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
};
const labelChip: React.CSSProperties = {
  background: 'rgba(74, 124, 255, 0.12)',
  border: '1px solid rgba(74, 124, 255, 0.3)',
  color: '#a0c4ff',
  padding: '3px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const smallBtn: React.CSSProperties = {
  background: '#4a7cff',
  color: 'white',
  border: 0,
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const smallBtnGhost: React.CSSProperties = { ...smallBtn, background: 'transparent', color: '#a0a8b8', border: '1px solid #4a4e56' };
