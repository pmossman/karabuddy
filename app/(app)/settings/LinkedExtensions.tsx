'use client';

import { useEffect, useState } from 'react';
import { requestInstallTokenFromExtension } from '@/lib/extensionBridge';
import { tokens } from '@/app/_theme/karabuddyTokens';

// B69: list the user's linked extension installs + show which row
// matches THIS browser. Lets users see what's linked and revoke
// installs they don't recognize.

interface LinkedExtension {
  token: string;
  linkedAt: string;
}

export function LinkedExtensions() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [extensions, setExtensions] = useState<LinkedExtension[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thisBrowserToken, setThisBrowserToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // token currently being revoked

  // Listen for both the bridge's proactive announcement AND fire an
  // explicit request — same pattern AutoClaim uses. Whichever returns
  // first tells us which row corresponds to this browser.
  useEffect(() => {
    let cancelled = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const data: any = e.data;
      if (!data || data.type !== 'karabuddy:availableInstallToken') return;
      const token = typeof data.token === 'string' ? data.token : null;
      if (!cancelled && token) setThisBrowserToken(token);
    };
    window.addEventListener('message', onMessage);
    (async () => {
      const t = await requestInstallTokenFromExtension(3000);
      if (!cancelled && t) setThisBrowserToken(t);
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('message', onMessage);
    };
  }, []);

  const load = async () => {
    setState('loading');
    try {
      const res = await fetch('/api/me/extensions');
      const body = await res.json();
      if (!body.ok) {
        setError(body.error || 'failed to load');
        setState('error');
        return;
      }
      setExtensions(body.extensions || []);
      setState('ready');
    } catch (err: any) {
      setError(err?.message || 'network error');
      setState('error');
    }
  };

  useEffect(() => { load(); }, []);

  const revoke = async (token: string) => {
    if (!confirm('Revoke this extension link? Future replays from this install will upload as anonymous until you re-link from that browser.')) return;
    setBusy(token);
    try {
      const res = await fetch('/api/me/extensions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (!body.ok) {
        alert(`Failed to revoke: ${body.error || 'unknown'}`);
      } else {
        await load();
      }
    } catch (err: any) {
      alert(`Failed to revoke: ${err?.message || 'network error'}`);
    } finally {
      setBusy(null);
    }
  };

  if (state === 'loading') return <div style={{ fontSize: 13, color: '#6c7588' }}>Loading…</div>;
  if (state === 'error') return <div style={{ fontSize: 13, color: '#ff7a7a' }}>{error}</div>;
  if (extensions.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 }}>
        No extension installs linked yet. Install the karabuddy extension and visit
        any page on karabuddy.app while signed in — it auto-links.
      </div>
    );
  }

  return (
    <div data-testid="linked-extensions-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {extensions.map((ext) => {
        const isThis = thisBrowserToken === ext.token;
        const short = ext.token.length > 16 ? ext.token.slice(0, 12) + '…' + ext.token.slice(-4) : ext.token;
        return (
          <div
            key={ext.token}
            data-testid="linked-extension-row"
            data-this-browser={isThis ? 'true' : 'false'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              background: tokens.surface.panel,
              border: '1px solid ' + (isThis ? tokens.led.on : tokens.surface.panelBorder),
              boxShadow: isThis ? `${tokens.surface.panelShadow}, 0 0 10px rgba(77, 210, 255, 0.12)` : tokens.surface.panelShadow,
              borderRadius: tokens.radius.md,
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#d6d6d6' }} title={ext.token}>{short}</span>
                {isThis && (
                  <span style={{ fontSize: 10, color: '#5db4ff', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                    This browser
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#6c7588' }}>
                Linked {new Date(ext.linkedAt).toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => revoke(ext.token)}
              disabled={busy === ext.token}
              style={{
                background: 'transparent',
                border: '1px solid #5a2a2a',
                color: '#ff6b6b',
                padding: '5px 12px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: busy === ext.token ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {busy === ext.token ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
