'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { Panel } from '@/app/_components/Panel';
import { LedToggle } from '@/app/_components/LedToggle';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { btnGhost } from '@/app/_components/buttonStyles';
import { tokens } from '@/app/_theme/karabuddyTokens';
import type { DerivedDeck, CardRef } from '@/lib/deckVersions';

const FORGE = '#ef8a3c';
const mono = tokens.led.mono;
const micro: CSSProperties = { font: `600 10px ${mono}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.color.textMuted };
const wrColor = (p: number) => (p >= 55 ? tokens.color.successText : p >= 45 ? tokens.color.warn : tokens.color.dangerSoft);
const wr = (w: number, l: number) => (w + l ? Math.round((w / (w + l)) * 100) : null);

// base identity → LeaderBasePair input (unique bases have art; vanilla/shared show a box)
const baseArt = (b: DerivedDeck['base']) => (b.art ? { set: b.art.set, number: b.art.number, name: b.label } : { name: b.label });

export function MigrateReview({ decks }: { decks: DerivedDeck[] }) {
  const [sel, setSel] = useState(() =>
    decks.map((d) => ({
      include: true,
      name: `${d.leader.name}${d.leader.subtitle ? ' · ' + d.leader.subtitle : ''}`,
      open: false,
      versions: d.versions.map(() => true),
    })),
  );
  const set = (i: number, patch: Partial<(typeof sel)[number]>) => setSel((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setVer = (i: number, vi: number, on: boolean) => setSel((p) => p.map((s, j) => (j === i ? { ...s, versions: s.versions.map((v, k) => (k === vi ? on : v)) } : s)));

  const totals = useMemo(() => {
    let d = 0, v = 0, g = 0;
    decks.forEach((deck, i) => {
      if (!sel[i].include) return;
      const vs = deck.versions.filter((_, vi) => sel[i].versions[vi]);
      if (!vs.length) return;
      d += 1; v += vs.length; g += vs.reduce((s, x) => s + x.games, 0);
    });
    return { d, v, g };
  }, [decks, sel]);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '26px 28px 64px', color: tokens.color.text, fontFamily: tokens.font.family }}>
      <div style={{ font: `600 11px ${mono}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: FORGE, marginBottom: 8 }}>
        karabuddy → SWU Forge
      </div>
      <h1 style={{ fontSize: 27, margin: '0 0 10px', letterSpacing: '-0.3px', fontWeight: 700 }}>Your decks, built from your replays</h1>
      <p style={{ color: tokens.color.textSecondary, fontSize: 15, maxWidth: '64ch', margin: '0 0 22px' }}>
        karabuddy grouped your recorded games by leader &amp; base and reconstructed each deck&apos;s version history from
        the list you ran over time. Pick what to send to SWU Forge — whole decks or specific versions — and rename them first.
      </p>

      {decks.length === 0 ? (
        <Panel padding={28} style={{ textAlign: 'center', color: tokens.color.textSecondary }}>
          No constructed decks found in your replays yet. Record some 50-card games and they&apos;ll show up here.
        </Panel>
      ) : (
        <>
          <StatStrip d={totals.d} v={totals.v} g={totals.g} />
          {decks.map((deck, i) => (
            <DeckCard key={deck.key} deck={deck} s={sel[i]}
              onToggle={(on) => set(i, { include: on })}
              onName={(name) => set(i, { name })}
              onOpen={() => set(i, { open: !sel[i].open })}
              onVer={(vi, on) => setVer(i, vi, on)} />
          ))}
          <Footer versions={totals.v} decks={totals.d} />
        </>
      )}
    </div>
  );
}

function StatStrip({ d, v, g }: { d: number; v: number; g: number }) {
  const cell = (val: number, label: string, color?: string) => (
    <div style={{ flex: 1, padding: '14px 16px', borderRight: `1px solid ${tokens.color.border}` }}>
      <div style={{ font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums', color: color ?? tokens.color.text }}>{val}</div>
      <div style={{ ...micro, marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, overflow: 'hidden', background: tokens.color.surface, marginBottom: 20 }}>
      {cell(d, 'Decks selected', FORGE)}
      {cell(v, 'Versions')}
      <div style={{ flex: 1, padding: '14px 16px' }}>
        <div style={{ font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums', color: tokens.led.on }}>{g}</div>
        <div style={{ ...micro, marginTop: 2 }}>Games behind them</div>
      </div>
    </div>
  );
}

function DeckCard({ deck, s, onToggle, onName, onOpen, onVer }: {
  deck: DerivedDeck; s: { include: boolean; name: string; open: boolean; versions: boolean[] };
  onToggle: (on: boolean) => void; onName: (n: string) => void; onOpen: () => void; onVer: (vi: number, on: boolean) => void;
}) {
  const p = wr(deck.wins, deck.losses);
  const ro = (val: React.ReactNode, label: string, color?: string) => (
    <div style={{ textAlign: 'right' }}>
      <div style={{ font: `600 15px ${mono}`, fontVariantNumeric: 'tabular-nums', color: color ?? tokens.color.text }}>{val}</div>
      <div style={{ font: `400 9px ${mono}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.color.textMuted }}>{label}</div>
    </div>
  );
  return (
    <Panel hud={false} padding={0} style={{ marginBottom: 10, opacity: s.include ? 1 : 0.5, borderColor: s.include ? 'rgba(239,138,60,0.26)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '12px 15px' }}>
        <LeaderBasePair leader={{ set: deck.leader.set ?? undefined, number: deck.leader.number ?? undefined, name: deck.leader.name }}
          base={baseArt(deck.base)} orientation="overlap" width={42} height={31} fit="cover" radius={4} fallback="box" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={s.name} onChange={(e) => onName(e.target.value)} spellCheck={false}
            style={{ font: `650 15px ${tokens.font.family}`, color: tokens.color.text, background: 'transparent', border: '1px solid transparent', borderRadius: 4, padding: '1px 4px', margin: '-1px -4px', width: '100%', maxWidth: 380 }} />
          <div style={{ ...micro, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, color: tokens.color.textMuted }}>
            {deck.leader.name} · {deck.base.label} · {deck.startAt}–{deck.endAt} · {deck.versions.length} version{deck.versions.length > 1 ? 's' : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {ro(deck.games, 'games')}
          {ro(`${deck.wins}–${deck.losses}`, 'W–L')}
          {ro(p != null ? `${p}%` : '–', 'win', p != null ? wrColor(p) : undefined)}
          <button onClick={onOpen} aria-label="Expand" style={{ background: 'none', border: 'none', color: tokens.color.textMuted, cursor: 'pointer', font: `12px ${mono}`, transform: s.open ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>▶</button>
          <LedToggle checked={s.include} onChange={onToggle} label="Include" variant="inline" />
        </div>
      </div>
      {s.open && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: 16, background: 'rgba(10,8,16,0.3)' }}>
          <TacticalHeading>Versions detected — from your decklist over time</TacticalHeading>
          {deck.versions.map((v, vi) => {
            const vp = wr(v.wins, v.losses);
            const on = s.versions[vi];
            return (
              <div key={v.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 12px', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.sm, background: tokens.color.surface, marginBottom: 7, opacity: on ? 1 : 0.5 }}>
                <span style={{ font: `700 13px ${mono}`, color: FORGE, width: 30, flex: '0 0 auto' }}>{v.label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: `12px ${mono}`, color: tokens.color.textSecondary }}>
                    {v.startAt}–{v.endAt} · {v.games} games · {v.wins}–{v.losses}
                    {vp != null && <span style={{ color: wrColor(vp) }}> ({vp}%)</span>}
                    <span style={{ color: tokens.color.textMuted }}> · {v.size}+{v.sideSize} sideboard</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
                    {v.diff ? <Diff diff={v.diff} /> : <span style={{ color: tokens.color.textMuted }}>initial list</span>}
                  </div>
                </div>
                <LedToggle checked={on} onChange={(x) => onVer(vi, x)} label="Send" variant="inline" />
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Diff({ diff }: { diff: { added: CardRef[]; removed: CardRef[] } }) {
  const chip = (c: CardRef, sign: '+' | '−', color: string) => (
    <span key={sign + c.id} style={{ color, marginRight: 10, whiteSpace: 'nowrap' }}>{sign}{c.count} {c.name ?? c.id}</span>
  );
  return (
    <span>
      {diff.added.map((c) => chip(c, '+', tokens.color.successText))}
      {diff.removed.map((c) => chip(c, '−', tokens.color.dangerSoft))}
    </span>
  );
}

function Footer({ versions, decks }: { versions: number; decks: number }) {
  const [done, setDone] = useState(false);
  const disabled = versions === 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26, paddingTop: 18, borderTop: `1px solid ${tokens.color.border}` }}>
      <span style={{ color: tokens.color.textMuted, font: `13px ${mono}` }}>
        {done ? `Prepared ${versions} version${versions === 1 ? '' : 's'} across ${decks} deck${decks === 1 ? '' : 's'} for SWU Forge.` : `${decks} deck${decks === 1 ? '' : 's'} · ${versions} version${versions === 1 ? '' : 's'} selected`}
      </span>
      <span style={{ flex: 1 }} />
      <button onClick={() => setDone(true)} disabled={disabled}
        style={{ ...glowButtonStyle, padding: '10px 18px', fontSize: 14, color: '#ffe7d6', border: `1px solid ${FORGE}`,
          boxShadow: `0 0 12px rgba(239,138,60,0.2)`, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        Migrate to SWU Forge
      </button>
    </div>
  );
}
