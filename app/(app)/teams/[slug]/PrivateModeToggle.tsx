'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCompanionInfo, extensionPresent, companionCapabilityState, loadedTeamKeys, openKeyManager } from '@/lib/companion';
import { Panel } from '@/app/_components/Panel';

// B170 / ADR 0010: the owner's "Private (encrypted) mode" control on the team
// Settings tab. The server only ever stores the NON-SECRET team_key_id (the key
// is generated/held in the extension); this UI is capability-gated and walks the
// owner through picking the key that secures the team. Enabling is exclusive —
// new replays for this team upload encrypted; existing plaintext ones stay as
// they are (we say so). Disabling reverts future uploads to plaintext.

type Phase = 'idle' | 'checking' | 'no-ext' | 'pick' | 'saving';

export function PrivateModeToggle({
  slug,
  initialPrivateMode,
  initialTeamKeyId,
}: {
  slug: string;
  initialPrivateMode: boolean;
  initialTeamKeyId: string | null;
}) {
  const router = useRouter();
  const [isPrivate, setIsPrivate] = useState(initialPrivateMode);
  const [teamKeyId, setTeamKeyId] = useState(initialTeamKeyId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [keys, setKeys] = useState<{ teamKeyId: string; name: string | null }[]>([]);
  const [picked, setPicked] = useState('');
  const [extState, setExtState] = useState<'absent' | 'unsupported'>('absent');
  const [error, setError] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/teams/${slug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json().catch(() => ({ ok: false }));
  };

  // Load the owner's keys that are SELECTABLE for this team: loaded on this device
  // AND not already used by another of your teams (B170: keys are one-per-team —
  // the server rejects reuse too; this just keeps an in-use key out of the picker).
  const fetchSelectableKeys = async () => {
    const loaded = await loadedTeamKeys();
    let inUse = new Set<string>();
    try {
      const md = await (await fetch('/api/me/teams-mention-data')).json();
      if (md?.ok) inUse = new Set((md.teams || []).filter((t: any) => t.slug !== slug && t.teamKeyId).map((t: any) => t.teamKeyId as string));
    } catch {}
    // Hide rotation artefacts the extension labels "(old key)" / "(new key)": an
    // old key is rotated-out (its replays moved to the current key), a new key is a
    // mid-rotation stage — neither is a valid key to (re)enable a team with, and
    // showing them next to the real key is just confusing (B170 re-enable).
    const rotationArtefact = /\((old|new) key\)\s*$/i;
    const selectable = loaded.filter((k) => !inUse.has(k.teamKeyId) && !rotationArtefact.test(k.name || ''));
    setKeys(selectable);
    setPicked((prev) => (selectable.some((k) => k.teamKeyId === prev) ? prev : (selectable[0]?.teamKeyId || '')));
    return selectable;
  };

  // Start the enable flow: gate on the extension, then load the owner's keys.
  const beginEnable = async () => {
    setError(null);
    setPhase('checking');
    const [info, present] = await Promise.all([getCompanionInfo(), extensionPresent()]);
    const cap = companionCapabilityState(info, present);
    if (cap !== 'supported') { setExtState(cap === 'unsupported' ? 'unsupported' : 'absent'); setPhase('no-ext'); return; }
    await fetchSelectableKeys();
    setPhase('pick');
  };

  // While picking a key, re-fetch on tab focus so a key just generated in the
  // key-manager tab appears in the dropdown without a manual page reload.
  useEffect(() => {
    if (phase !== 'pick') return;
    const onFocus = () => { fetchSelectableKeys(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, slug]);

  const enable = async () => {
    if (!picked) return;
    setPhase('saving');
    const body = await patch({ privateMode: true, teamKeyId: picked });
    // router.refresh() re-renders the server page so the sibling privacy sections
    // (team key / readiness / rotate / member banner) appear without a manual reload.
    if (body.ok) { setIsPrivate(true); setTeamKeyId(picked); setPhase('idle'); router.refresh(); }
    else { setError(body.error || 'Could not enable private mode.'); setPhase('pick'); }
  };

  const disable = async () => {
    if (!window.confirm('Turn off private mode? New replays will upload as normal (plaintext). Already-encrypted replays stay encrypted and still need the key to view.')) return;
    setPhase('saving');
    const body = await patch({ privateMode: false });
    if (body.ok) { setIsPrivate(false); setTeamKeyId(null); setPhase('idle'); router.refresh(); }
    else { setError(body.error || 'Could not disable private mode.'); setPhase('idle'); }
  };

  const btn = (primary: boolean): React.CSSProperties => ({
    cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, fontFamily: 'inherit',
    border: primary ? '1px solid rgba(77,210,255,0.55)' : '1px solid rgba(255,255,255,0.18)',
    background: primary ? 'rgba(77,210,255,0.12)' : 'transparent', color: primary ? '#9fe6ff' : '#c2c9d6',
  });
  const desc: React.CSSProperties = { margin: '4px 0 12px', fontSize: 13, color: '#a0a8b8', lineHeight: 1.5 };

  return (
    <Panel>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#e6ebf2' }}>{isPrivate ? 'Private mode is ON' : 'Private (encrypted) mode'}</div>

      {isPrivate ? (
        <>
          <p style={desc}>
            Replays for this team are end-to-end encrypted — <strong>not even the KaraBuddy team can read them</strong>
            (no cards, decks, or comments). Members need this team&apos;s key loaded in their extension to view or record.
          </p>
          <button onClick={disable} disabled={phase === 'saving'} style={btn(false)}>Turn off private mode</button>
        </>
      ) : phase === 'idle' ? (
        <>
          <p style={desc}>
            Make this team&apos;s replays end-to-end encrypted, so only members with the team key can view them —
            <strong> not even the KaraBuddy team can read them</strong>. You&apos;ll secure the team with a key from
            your extension.
          </p>
          <button onClick={beginEnable} style={btn(true)}>Make this team private</button>
        </>
      ) : phase === 'checking' || phase === 'saving' ? (
        <p style={desc}>Working…</p>
      ) : phase === 'no-ext' ? (
        <>
          <p style={desc}>
            {extState === 'unsupported'
              ? 'Your KaraBuddy extension is too old for private teams — update it, then try again.'
              : 'Private teams need the KaraBuddy extension (keys live there, never on karabuddy).'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link href="/install" style={{ ...btn(true), textDecoration: 'none', display: 'inline-block' }}>
              {extState === 'unsupported' ? 'How to update' : 'Install the extension'}
            </Link>
            <button onClick={beginEnable} style={btn(false)}>Re-check</button>
          </div>
        </>
      ) : (
        // phase === 'pick'
        <>
          {keys.length === 0 ? (
            <>
              <p style={desc}>First create a team key in your extension — then come back and pick it here. Share that key with your teammates out-of-band.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={async () => { await openKeyManager({ makePrivate: slug }); }} style={btn(true)}>Open key manager</button>
                <button onClick={beginEnable} style={btn(false)}>I&apos;ve added one — refresh</button>
              </div>
            </>
          ) : (
            <>
              <p style={desc}>Encrypt this team with which key? (Generate or add one in the key manager if it&apos;s not here.)</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={picked} onChange={(e) => setPicked(e.target.value)} style={{ padding: '8px 10px', borderRadius: 6, background: '#0b0e13', border: '1px solid #2e333c', color: '#d6f0ff', fontFamily: 'inherit', fontSize: 13 }}>
                  {keys.map((k) => <option key={k.teamKeyId} value={k.teamKeyId}>{k.name || k.teamKeyId}</option>)}
                </select>
                <button onClick={enable} disabled={!picked} style={btn(true)}>Enable private mode</button>
                <button onClick={async () => { await openKeyManager({ makePrivate: slug }); }} style={btn(false)}>Key manager</button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#ff6b6b' }}>{error}</p>}
    </Panel>
  );
}
