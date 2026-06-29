'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B204 (DRY overlays): one confirmation dialog, replacing two bespoke confirm
// modals (UnshareConfirm, the tournament ConfirmModal) AND ~8 native
// window.confirm() calls (which bypassed the design system — ADR-0006).

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, busy, onConfirm, onCancel,
}: ConfirmOptions & { open: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} ariaLabel={title} width="min(440px, 92vw)" z={1000}>
      <div style={{ padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#c2c8d4', lineHeight: 1.5, margin: '0 0 16px', wordBreak: 'break-word', whiteSpace: 'normal' }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={busy} style={cancelBtn}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} disabled={busy} style={destructive ? dangerBtn : primaryBtn} data-testid="confirm-dialog-confirm">
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Promise-based confirm — drop-in for `if (!window.confirm(msg)) return`:
//   const { confirm, confirmDialog } = useConfirm();
//   ... if (!(await confirm({ title, message, destructive: true }))) return;
//   ... return (<>{confirmDialog}{rest}</>)
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOptions; resolve: ((v: boolean) => void) | null }>(
    { open: false, opts: { title: '', message: '' }, resolve: null },
  );
  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ open: true, opts, resolve })),
    [],
  );
  const settle = (v: boolean) => setState((s) => { s.resolve?.(v); return { ...s, open: false, resolve: null }; });
  const confirmDialog = (
    <ConfirmDialog open={state.open} {...state.opts} onConfirm={() => settle(true)} onCancel={() => settle(false)} />
  );
  return { confirm, confirmDialog };
}

const cancelBtn: React.CSSProperties = { background: 'transparent', border: `1px solid ${tokens.color.border}`, color: tokens.color.textSecondary, padding: '6px 14px', borderRadius: tokens.radius.md, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const dangerBtn: React.CSSProperties = { background: 'rgba(255,107,107,0.14)', border: '1px solid #5a2a2a', color: tokens.color.danger, padding: '6px 14px', borderRadius: tokens.radius.md, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const primaryBtn: React.CSSProperties = { background: tokens.color.primarySoft, border: `1px solid ${tokens.color.primary}`, color: tokens.color.accent, padding: '6px 14px', borderRadius: tokens.radius.md, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
