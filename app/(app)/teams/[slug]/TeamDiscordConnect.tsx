'use client';

import { useEffect, useState } from 'react';

// B81: owner-only "magic" Discord connect for a team. Not connected → one
// button that opens Discord's bot-invite (server picker) and bounces back here.
// Connected → a channel dropdown (auto-populated via the bot), a test button,
// and disconnect. Team activity posts to the chosen channel.
export function TeamDiscordConnect({
  slug,
  authorizeUrl,
  initialGuildId,
  initialChannelId,
}: {
  slug: string;
  authorizeUrl: string | null;
  initialGuildId: string | null;
  initialChannelId: string | null;
}) {
  const [guildId, setGuildId] = useState(initialGuildId);
  const [channelId, setChannelId] = useState(initialChannelId);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [picked, setPicked] = useState(initialChannelId || '');
  const [msg, setMsg] = useState<string | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('discord') === 'connected') {
      setJustConnected(true);
    }
  }, []);

  // Load channels (+ authoritative state) whenever a guild is connected.
  useEffect(() => {
    if (!guildId) return;
    let live = true;
    fetch(`/api/teams/${slug}/discord`)
      .then((r) => r.json())
      .then((b) => {
        if (!live || !b.ok) return;
        setChannels(b.channels || []);
        setChannelId(b.channelId || null);
        setPicked(b.channelId || '');
      })
      .catch(() => {});
    return () => { live = false; };
  }, [guildId, slug]);

  const saveChannel = async () => {
    if (!picked) return;
    const r = await fetch(`/api/teams/${slug}/discord`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: picked }) });
    const b = await r.json();
    if (b.ok) { setChannelId(picked); setMsg('Saved.'); } else setMsg(b.error || 'failed');
  };
  const sendTest = async () => {
    setMsg('Sending…');
    const r = await fetch(`/api/teams/${slug}/discord/test`, { method: 'POST' });
    const b = await r.json();
    setMsg(b.ok ? 'Test sent — check the channel.' : b.skipped ? 'Bot not configured yet.' : b.error || 'failed');
  };
  const disconnect = async () => {
    const r = await fetch(`/api/teams/${slug}/discord`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ disconnect: true }) });
    if ((await r.json()).ok) { setGuildId(null); setChannelId(null); setChannels([]); setPicked(''); setMsg(null); }
  };

  const card: React.CSSProperties = { marginTop: 24, padding: 16, background: 'rgba(17,20,26,0.5)', border: '1px solid #2e333c', borderRadius: 8 };
  const heading = <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 600 }}>Team Discord</h3>;
  const discordBtn: React.CSSProperties = { display: 'inline-block', background: '#5865F2', color: '#fff', border: 0, borderRadius: 6, padding: '9px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit' };

  if (!guildId) {
    return (
      <section style={card}>
        {heading}
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
          Connect a Discord server and KaraBuddy will post this team&apos;s activity (and @-ping mentioned members) in a channel you choose.
        </p>
        {authorizeUrl ? (
          <a href={authorizeUrl} style={discordBtn}>Connect this team&apos;s Discord</a>
        ) : (
          <span style={{ fontSize: 12, color: '#6c7588' }}>Discord isn&apos;t configured on this server yet.</span>
        )}
      </section>
    );
  }

  return (
    <section style={card}>
      {heading}
      {justConnected && !channelId && (
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#6bd968' }}>Bot added ✓ — now pick the channel to post in.</p>
      )}
      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#a0a8b8', lineHeight: 1.5 }}>
        {channelId
          ? <>Posting team activity to <strong style={{ color: '#d6f0ff' }}>#{channels.find((c) => c.id === channelId)?.name || channelId}</strong>.</>
          : 'Connected. Choose a channel:'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          style={{ background: '#11141a', color: '#e6e6e6', border: '1px solid #2e333c', borderRadius: 6, padding: '7px 10px', font: '13px inherit' }}
        >
          <option value="">{channels.length ? 'Select a channel…' : 'Loading channels…'}</option>
          {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
        </select>
        <button type="button" onClick={saveChannel} disabled={!picked || picked === channelId} style={{ background: '#4a7cff', color: '#fff', border: 0, borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: !picked || picked === channelId ? 0.6 : 1 }}>Save</button>
        {channelId && <button type="button" onClick={sendTest} style={{ background: 'transparent', color: '#a0c4ff', border: '1px solid #4a7cff', borderRadius: 6, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Send test</button>}
        <button type="button" onClick={disconnect} style={{ background: 'transparent', color: '#a0a8b8', border: '1px solid #4a4e56', borderRadius: 6, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Disconnect</button>
      </div>
      {msg && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6bd968' }}>{msg}</p>}
    </section>
  );
}
