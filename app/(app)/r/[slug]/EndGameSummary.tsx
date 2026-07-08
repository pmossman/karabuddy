'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import type { EndGameStats, PlayerEndStats } from '@/lib/endGameStats';

// B104: end-of-replay summary card. Shown when you reach the final frame —
// makes the result unambiguous (who won, and HOW: base destruction vs a
// concession, which is otherwise invisible since the conceding player's board
// is untouched) and surfaces a few satisfying per-player totals. Overlays the
// board only (the sidebar + frame chevrons stay live), and the parent hides it
// the moment you step back, so it never gets in the way of reviewing.

const ACCENT = '#4d9dff';

export function EndGameSummary({
  stats,
  players,
  localPlayerId,
  onClose,
  nextGame,
}: {
  stats: EndGameStats;
  players: any[];
  localPlayerId: string | null;
  onClose: () => void;
  // B229: when this replay is a Bo3 game with a NEXT game recorded, offer to
  // jump straight to it from the end-of-game summary.
  nextGame?: { slug: string; gameNumber: number } | null;
}) {
  // Order columns to match the matchup header (replay.players order), falling
  // back to the stats order. Map each column to its computed stats by id.
  const byId = new Map(stats.players.map((p) => [p.playerId, p]));
  const ordered: { player: any; s: PlayerEndStats }[] = [];
  for (const pl of players || []) {
    const s = byId.get(pl.id);
    if (s) { ordered.push({ player: pl, s }); byId.delete(pl.id); }
  }
  for (const s of byId.values()) ordered.push({ player: { id: s.playerId, username: s.username }, s });
  const [a, b] = ordered;

  const winner = stats.players.find((p) => p.won);
  const loser = stats.players.find((p) => p.won === false);
  const winnerName = winner?.username || 'A player';
  const headline =
    stats.endReason === 'unknown'
      ? 'Game over'
      : `${winnerName} wins`;
  const subline =
    stats.endReason === 'base'
      ? 'by base destruction'
      : stats.endReason === 'concede'
        ? `${loser?.username || 'Opponent'} conceded`
        : 'result not recorded';

  // Esc closes; matches the dismiss × and the backdrop click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!a || !b) return null;

  const rows: { label: string; key: keyof PlayerEndStats }[] = [
    { label: 'Base damage dealt', key: 'baseDamageDealt' },
    { label: 'Base damage healed', key: 'baseDamageHealed' },
    { label: 'Cards played', key: 'cardsPlayed' },
    { label: 'Units defeated', key: 'unitsDefeated' },
    { label: 'Resources floated', key: 'resourcesFloated' },
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(6, 9, 14, 0.55)', backdropFilter: 'blur(3px)',
        animation: 'kb-egs-fade 200ms ease',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label="Game summary"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(420px, 100%)', maxHeight: '100%', overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(23,28,38,0.98), rgba(15,18,26,0.98))',
          border: `1px solid ${ACCENT}55`,
          borderRadius: 14,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          padding: '20px 20px 18px',
          color: '#e6e9ef',
          fontFamily: 'var(--font-barlow), -apple-system, sans-serif',
          animation: 'kb-egs-pop 260ms cubic-bezier(0.34, 1.4, 0.5, 1)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close summary"
          style={{
            position: 'absolute', top: 8, right: 10, zIndex: 1,
            background: 'transparent', border: 0, color: '#8b93a5',
            fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}
        >
          ×
        </button>

        {/* Headline */}
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 30, lineHeight: 1, marginBottom: 6 }} aria-hidden="true">
            {stats.endReason === 'unknown' ? '⚑' : '🏆'}
          </div>
          <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '0.01em' }}>{headline}</div>
          <div style={{ fontSize: 12.5, color: '#9aa3b4', marginTop: 3, textTransform: 'capitalize' }}>
            {subline}
            {stats.rounds > 0 && <span style={{ color: '#6c7588' }}> · {stats.rounds} rounds</span>}
          </div>
        </div>

        {/* Player columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
          <PlayerHead entry={a} isLocal={a.player.id === localPlayerId} />
          <PlayerHead entry={b} isLocal={b.player.id === localPlayerId} />
        </div>

        {/* Stat rows: value | label | value */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 8 }}>
          {rows.map((row, i) => {
            const av = a.s[row.key] as number;
            const bv = b.s[row.key] as number;
            return (
              <div
                key={row.key}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
                  gap: 8, padding: '7px 4px',
                  background: i % 2 ? 'rgba(255,255,255,0.025)' : 'transparent',
                  borderRadius: 6,
                }}
              >
                <StatValue value={av} highlight={av > bv} align="right" delay={i * 70} />
                <span style={{ fontSize: 11, color: '#8b93a5', textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {row.label}
                </span>
                <StatValue value={bv} highlight={bv > av} align="left" delay={i * 70} />
              </div>
            );
          })}
        </div>

        {/* B229: series continuation — jump to the next game of the Bo3. */}
        {nextGame && (
          <Link
            href={`/r/${nextGame.slug}`}
            data-testid="next-game-cta"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 16, padding: '10px 16px', borderRadius: 8,
              background: 'rgba(77,210,255,0.12)', border: '1px solid #4dd2ff',
              color: '#cfe4ff', fontSize: 14, fontWeight: 800, textDecoration: 'none',
            }}
          >
            Go to Game {nextGame.gameNumber} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>

      <style>{`
        @keyframes kb-egs-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes kb-egs-pop { from { opacity: 0; transform: translateY(8px) scale(0.97); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

function PlayerHead({ entry, isLocal }: { entry: { player: any; s: PlayerEndStats }; isLocal: boolean }) {
  const { player, s } = entry;
  const won = s.won === true;
  const lost = s.won === false;
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        padding: '10px 6px', borderRadius: 10,
        border: `1px solid ${won ? `${ACCENT}66` : 'rgba(255,255,255,0.06)'}`,
        background: won ? `${ACCENT}1f` : 'rgba(255,255,255,0.02)',
      }}
    >
      <LeaderBasePair
        leader={player.leader}
        base={player.base}
        orientation="overlap"
        width={46}
        height={32}
        fit="cover"
        radius={3}
        background="rgba(255,255,255,0.06)"
        border="none"
        fallback="box"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
        {(won || lost) && (
          <span
            style={{
              fontSize: 10, fontWeight: 800, lineHeight: 1, padding: '2px 4px', borderRadius: 3,
              background: won ? '#2f9e54' : '#b3403f', color: '#fff',
            }}
          >
            {won ? 'W' : 'L'}
          </span>
        )}
        <span style={{ fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.username || 'anon'}
        </span>
      </div>
      {isLocal && <span style={{ fontSize: 9.5, color: ACCENT, fontWeight: 700, letterSpacing: '0.05em' }}>YOU</span>}
    </div>
  );
}

// Count-up animation for the wow factor — runs once on mount (the summary
// remounts each time you reach the end, so it replays).
function StatValue({ value, highlight, align, delay }: { value: number; highlight: boolean; align: 'left' | 'right'; delay: number }) {
  const display = useCountUp(value, 520, delay);
  return (
    <span
      style={{
        fontSize: 17, fontWeight: 800, textAlign: align, fontVariantNumeric: 'tabular-nums',
        color: highlight && value > 0 ? ACCENT : '#e6e9ef',
      }}
    >
      {display}
    </span>
  );
}

function useCountUp(target: number, durationMs: number, delayMs: number): number {
  const [v, setV] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  useEffect(() => {
    if (target <= 0) { setV(0); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const tick = (now: number) => {
        if (cancelled) return;
        if (startRef.current == null) startRef.current = now;
        const t = Math.min(1, (now - startRef.current) / durationMs);
        // easeOutCubic
        const eased = 1 - Math.pow(1 - t, 3);
        setV(Math.round(target * eased));
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, delayMs]);
  return v;
}
