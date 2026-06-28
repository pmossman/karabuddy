'use client';

import React, { useState } from 'react';
import { LedToggle } from './LedToggle';

// B202: the shared building blocks of the replay-share UI, used by BOTH the
// single-replay `ShareWithTeam` (immediate, binary) and the bulk
// `BulkShareControls` (staged, tri-state). Before this they were two near-copies
// that drifted — the bulk menu kept help text the single one had dropped. The
// COPY + structure now live here once; each caller wires its own state/handlers.

export const shareSectionLabel: React.CSSProperties = {
  fontSize: 11, color: '#6c7588', textTransform: 'uppercase', letterSpacing: '0.06em',
};

// The canonical public-replay privacy explanation — one source of truth.
export const PUBLIC_INFO =
  'Public replays are listed in the public browser — anyone can watch and read the comments ' +
  '(author names anonymized, @mentions redacted). Off: only people with the link or your shared ' +
  'teams can see them.';

// Tap-to-reveal ⓘ — keeps optional help text out of the way until asked for.
export function InfoDot({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={open}
      title={label}
      style={{
        width: 16, height: 16, flex: '0 0 auto', borderRadius: '50%', padding: 0, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, lineHeight: 1, fontFamily: 'Georgia, serif', fontStyle: 'italic',
        background: open ? 'rgba(77,157,255,0.25)' : 'transparent',
        border: '1px solid rgba(77,157,255,0.45)', color: '#8fd0ff',
      }}
    >
      i
    </button>
  );
}

// The "request team review" star — same control whether the request fires
// immediately (single) or is staged for Apply (bulk); the caller owns the verb.
export function ReviewStar({
  on, onToggle, disabled, labelOn, labelOff, testId,
}: {
  on: boolean; onToggle: () => void; disabled?: boolean; labelOn: string; labelOff: string; testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      data-testid={testId}
      style={{
        alignSelf: 'flex-start', marginLeft: 26, display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 0, padding: '1px 0', cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit', fontSize: 11, fontWeight: 600, color: on ? '#ffc357' : '#6c7588',
      }}
    >
      <span aria-hidden style={{ fontSize: 12 }}>{on ? '★' : '☆'}</span>
      {on ? labelOn : labelOff}
    </button>
  );
}

// A small left-indented note under a toggle (block reason / mixed-state hint).
export function ToggleNote({ color = '#8a93a3', children }: { color?: string; children: React.ReactNode }) {
  return <div style={{ marginLeft: 26, fontSize: 11, color, fontStyle: 'italic', lineHeight: 1.4 }}>{children}</div>;
}

// One team row: the share LedToggle + an optional note + an optional review star.
// `indeterminate` covers the bulk tri-state ("mixed"); single never sets it.
export function TeamShareRow({
  label, checked, indeterminate, disabled, onToggle, note, review,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onToggle: () => void;
  note?: React.ReactNode;
  review?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <LedToggle checked={checked} indeterminate={indeterminate} onChange={onToggle} label={label} statusOn="Sharing" disabled={disabled} />
      {note}
      {review}
    </div>
  );
}

// The Public section: label + ⓘ + the public toggle + (tap-to-reveal) canonical
// privacy copy. `note` is an optional mixed-state hint (bulk only).
export function PublicShareSection({
  checked, indeterminate, disabled, onChange, note,
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  note?: React.ReactNode;
}) {
  const [info, setInfo] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={shareSectionLabel}>Public</span>
        <InfoDot open={info} onClick={() => setInfo((v) => !v)} label="About public replays" />
      </div>
      <LedToggle checked={checked} indeterminate={indeterminate} onChange={onChange} label="Public replay" statusOn="Public" disabled={disabled} />
      {note}
      {info && <div style={{ fontSize: 11, color: '#8a93a3', fontStyle: 'italic', lineHeight: 1.4 }}>{PUBLIC_INFO}</div>}
    </div>
  );
}
