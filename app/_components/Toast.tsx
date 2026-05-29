'use client';

import { useEffect } from 'react';

// Page-level toast — small, top-right, auto-dismiss after 6s. Distinct
// from the extension's launcher-anchored toast: that one runs on
// karabast.net and tracks the floating launcher's bounds. This one
// runs on karabuddy.app pages and just floats in the top-right corner.
//
// Single message at a time. Caller manages the message string + the
// dismiss callback; this component is presentational + handles the
// fade-out timer.
export function Toast({
  message,
  onDismiss,
  durationMs = 6000,
}: {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 'max(70px, calc(var(--kb-header-h, 0px) + 14px))',
        right: 14,
        zIndex: 100,
        maxWidth: 340,
        background: 'rgba(36, 48, 68, 0.96)',
        color: '#e6e6e6',
        border: '1px solid rgba(74, 222, 128, 0.45)',
        borderRadius: 10,
        padding: '10px 12px 10px 14px',
        fontSize: 13,
        fontFamily: 'var(--font-barlow), -apple-system, BlinkMacSystemFont, sans-serif',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(6px)',
        animation: 'kb-toast-slide-in 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <style>{`
        @keyframes kb-toast-slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          color: '#a0a8b8',
          border: 0,
          padding: 0,
          width: 18,
          height: 18,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  );
}
