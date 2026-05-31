'use client';

import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Selection control for the KaraBuddy chrome, built on the extension's cyan-LED
// motif (extension/replays/05-footer.js buildShareRow). Two variants:
//   - "row" (default): the full "cockpit" control — glowing LED + left accent
//     bar + filled row + monospace label + optional status readout ("SHARING").
//     For dense tactical panels (share popover, comment scope, the extension).
//   - "inline": just the LED indicator + a readable sans label, no row chrome.
//     For plain settings toggles, where the full row overbears.
// Both draw from the same `led` tokens so the LED reads consistently. Use this
// instead of MUI checkboxes/radios for on/off + multi-select toggles.
export function LedToggle({
  checked,
  onChange,
  label,
  statusOn,
  disabled = false,
  shape = 'checkbox',
  variant = 'row',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  // Optional uppercase readout shown on the right when checked (row variant only).
  statusOn?: string;
  disabled?: boolean;
  // Square LED for multi-select (checkbox), round LED for an exclusive choice (radio).
  shape?: 'checkbox' | 'radio';
  // "row" = full cockpit control; "inline" = subtle LED + sans label.
  variant?: 'row' | 'inline';
}) {
  const [hover, setHover] = useState(false);
  const ledRadius = shape === 'radio' ? '50%' : 3;
  const role = shape === 'radio' ? 'radio' : 'checkbox';
  const accent = checked ? tokens.led.on : tokens.led.off;
  const isRow = variant === 'row';
  // The full glow is a "live signal" in the dense row; soften it in the calm
  // inline (settings) context so it doesn't bloom.
  const ringGlowOn = isRow ? tokens.led.ringGlow : tokens.led.ringGlowSoft;
  const dotGlowOn = isRow ? tokens.led.dotGlow : tokens.led.dotGlowSoft;
  const rowBackground = checked
    ? tokens.led.rowOn
    : hover && !disabled
      ? tokens.led.rowHover
      : tokens.led.rowOff;

  const led = (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 12,
        height: 12,
        borderRadius: ledRadius,
        border: `1.5px solid ${accent}`,
        background: 'rgba(0, 0, 0, 0.45)',
        boxShadow: checked ? ringGlowOn : tokens.led.ringInert,
        flex: '0 0 auto',
        transition: 'box-shadow 120ms ease, border-color 120ms ease',
      }}
    >
      {checked && (shape === 'radio' ? (
        // Radio: filled center dot (dot-in-circle = "selected").
        <span style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', background: tokens.led.on, boxShadow: dotGlowOn }} />
      ) : (
        // Checkbox: a checkmark = "on" (a square-in-square reads as indeterminate).
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.4 6.4 L4.8 8.8 L9.6 3.2" stroke={tokens.led.on} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );

  const interactive = {
    role,
    'aria-checked': checked,
    'aria-label': label,
    'aria-disabled': disabled || undefined,
    tabIndex: disabled ? -1 : 0,
    onClick: () => { if (!disabled) onChange(!checked); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!checked); }
    },
  } as const;

  if (!isRow) {
    // Calm inline variant — LED + readable sans label, no row chrome.
    return (
      <div
        {...interactive}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
          padding: '3px 0',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          userSelect: 'none',
        }}
      >
        {led}
        <span style={{ fontSize: 13, lineHeight: 1.3, color: checked ? tokens.color.text : tokens.color.textSecondary }}>
          {label}
        </span>
      </div>
    );
  }

  return (
    <div
      {...interactive}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 9px',
        background: rowBackground,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        userSelect: 'none',
      }}
    >
      {led}
      <span
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          font: `600 12px ${tokens.led.mono}`,
          color: checked ? tokens.led.textOn : tokens.led.textOff,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </span>
      {checked && statusOn && (
        <span
          aria-hidden
          style={{
            font: `700 9px ${tokens.led.mono}`,
            color: tokens.led.on,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            flex: '0 0 auto',
          }}
        >
          {statusOn}
        </span>
      )}
    </div>
  );
}
