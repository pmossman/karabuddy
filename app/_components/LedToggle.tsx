'use client';

import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';

// Signature selection control for the KaraBuddy chrome — a React port of the
// extension's "cockpit" share row (extension/replays/05-footer.js buildShareRow):
// a glowing cyan LED ring + dot, a left accent bar, a monospace label, and an
// optional far-right status readout (e.g. "SHARING"). This is the shared design
// language across the web app and the extension; both draw from the same `led`
// tokens so they read as one product. Use this instead of MUI checkboxes/radios
// for on/off and multi-select toggles.
export function LedToggle({
  checked,
  onChange,
  label,
  statusOn,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  // Optional uppercase readout shown on the right when checked (e.g. "Sharing").
  statusOn?: string;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const accent = checked ? tokens.led.on : tokens.led.off;
  const background = checked
    ? tokens.led.rowOn
    : hover && !disabled
      ? tokens.led.rowHover
      : tokens.led.rowOff;

  return (
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!disabled) onChange(!checked); }}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(!checked); }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '6px 9px',
        background,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        userSelect: 'none',
      }}
    >
      {/* LED ring + center dot (dot lit only when on). */}
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 12,
          height: 12,
          borderRadius: '50%',
          border: `1.5px solid ${accent}`,
          background: 'rgba(0, 0, 0, 0.45)',
          boxShadow: checked ? tokens.led.ringGlow : tokens.led.ringInert,
          flex: '0 0 auto',
          transition: 'box-shadow 120ms ease, border-color 120ms ease',
        }}
      >
        {checked && (
          <span style={{ display: 'block', width: 5, height: 5, borderRadius: '50%', background: tokens.led.on, boxShadow: tokens.led.dotGlow }} />
        )}
      </span>

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
