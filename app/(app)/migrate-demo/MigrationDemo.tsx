'use client';

import { useState, type CSSProperties } from 'react';
import { Panel } from '@/app/_components/Panel';
import { LedToggle } from '@/app/_components/LedToggle';
import { Segmented } from '@/app/_components/Segmented';
import { LeaderBasePair } from '@/app/_components/LeaderBasePair';
import { TacticalHeading } from '@/app/_components/TacticalHeading';
import { glowButtonStyle } from '@/app/_components/glowButton';
import { btnGhost } from '@/app/_components/buttonStyles';
import { tokens } from '@/app/_theme/karabuddyTokens';

// ─────────────────────────────────────────────────────────────────────────────
// DEMO: karabuddy → SWU Forge team migration. Faked data, no backend — for
// gathering UX feedback, not a real feature. Built on the karabuddy design
// system (Panel / LedToggle / Segmented / LeaderBasePair / TacticalHeading /
// glow buttons / tokens). The one non-token colour is the SWU-Forge "forge
// ember" accent (FORGE) — deliberately introduced here to represent the partner
// brand. The aesthetic shifts step by step from karabuddy (cyan/cold) toward a
// merged karabuddy×Forge look (ember/warm): the karabuddy components stay
// constant as the through-line while the Forge branding + accent fade in.
// ─────────────────────────────────────────────────────────────────────────────

// SWU Forge partner-brand accent (not a karabuddy token — intentional).
const FORGE = '#ef8a3c';
const FORGE_2 = '#ffb066';
const FORGE_SOFT = 'rgba(239,138,60,0.14)';
// Per-step accent: karabuddy cyan → forge ember. Background warmth + Forge-brand
// opacity ramp alongside it.
const ACCENT = ['#4dd2ff', '#6ba0e6', '#9d83c9', '#d18a67', '#ec8a3f', FORGE];
const WARM_A = [0, 0.025, 0.05, 0.07, 0.09, 0.11];
const DEST_OP = [0.45, 0.62, 0.76, 0.86, 0.95, 1];

type Card = { set: string; number: number; name: string };
type Version = { tag: string; desc: string; note: string; win: string };
type Deck = {
  id: string; leader: Card; base: Card; aspect: string; hp: number;
  games: number; w: number; l: number; span: string; who: string[];
  tags: string[]; versions: Version[]; size: number; sb: number;
  main: { c: number; q: number; n: string }[]; side: { c: number; q: number; n: string }[];
};

const MEMBERS = [
  { id: 'drew', name: 'Drew Knox', role: 'Owner', provider: 'google', matched: true, email: 'drew.knox@gmail.com', games: 118, av: FORGE },
  { id: 'sky', name: 'Skyler Vance', role: 'Member', provider: 'discord', matched: true, email: 'skyvance#4417', games: 96, av: tokens.led.on },
  { id: 'tatum', name: 'Tatum Lee', role: 'Member', provider: 'google', matched: true, email: 'tatum.lee@gmail.com', games: 74, av: tokens.color.success },
  { id: 'rowan', name: 'Rowan Vega', role: 'Member', provider: 'google', matched: true, email: 'rowan.v@gmail.com', games: 62, av: tokens.color.primary },
  { id: 'riley', name: 'Riley Lee', role: 'Member', provider: 'discord', matched: false, email: null, games: 44, av: '#c78bff' },
  { id: 'morg', name: 'Morgan Webb', role: 'Member', provider: 'discord', matched: false, email: null, games: 18, av: tokens.color.warn },
];

const mainSample = (): { c: number; q: number; n: string }[] => [
  { c: 1, q: 2, n: 'Confiscate' }, { c: 1, q: 3, n: 'Bamboozle' }, { c: 2, q: 3, n: 'Cantina Braggart' },
  { c: 2, q: 2, n: 'Pyke Sentinel' }, { c: 3, q: 2, n: 'Waylay' }, { c: 3, q: 3, n: 'Fleet Lieutenant' },
  { c: 4, q: 2, n: 'Cell Block Guard' }, { c: 5, q: 2, n: 'Boba Fett, Daimyo' }, { c: 6, q: 1, n: 'Krayt Dragon' },
];
const sideSample = [{ c: 2, q: 2, n: 'Vanquish' }, { c: 3, q: 2, n: 'Takedown' }, { c: 1, q: 3, n: 'Open Fire' }, { c: 4, q: 3, n: 'Change of Heart' }];

const DECKS: Deck[] = [
  { id: 'cadbane', leader: { set: 'ASH', number: 11, name: 'Cad Bane' }, base: { set: 'SOR', number: 21, name: 'Dagobah Swamp' },
    aspect: 'Vigilance', hp: 30, games: 119, w: 71, l: 48, span: 'May 3 – Jun 25', who: ['drew', 'sky', 'tatum'],
    tags: ['sideboard included', '4 pilots'], size: 50, sb: 10, main: mainSample(), side: sideSample, versions: [
      { tag: 'v1', desc: 'Launch list, heavy Pyke aggro', note: 'May 3 · 45 games', win: '59%' },
      { tag: 'v2', desc: '−2 Cantina Braggart, +2 Cad Bane leader unit, +1 Waylay', note: 'Jun 6 · 74 games · current', win: '62%' } ] },
  { id: 'wedge', leader: { set: 'JTL', number: 8, name: 'Wedge Antilles' }, base: { set: 'ASH', number: 23, name: 'Ancient Henge' },
    aspect: 'Aggression', hp: 30, games: 85, w: 52, l: 33, span: 'May 1 – Jun 23', who: ['sky', 'rowan'],
    tags: [], size: 50, sb: 10, main: mainSample(), side: sideSample, versions: [
      { tag: 'v1', desc: 'Snubfighter tempo', note: 'May 1 · 30 games', win: '57%' },
      { tag: 'v2', desc: '+2 Green Squadron, −2 Wingman', note: 'May 20 · 29 games', win: '62%' },
      { tag: 'v3', desc: '+1 Rogue Squadron, sideboard reshuffle', note: 'Jun 12 · 26 games · current', win: '65%' } ] },
  { id: 'vader', leader: { set: 'JTL', number: 6, name: 'Darth Vader' }, base: { set: 'SHD', number: 23, name: 'Death Watch Hideout' },
    aspect: 'Aggression', hp: 30, games: 75, w: 40, l: 35, span: 'May 5 – Jun 9', who: ['drew', 'tatum', 'morg'],
    tags: [], size: 50, sb: 10, main: mainSample(), side: sideSample, versions: [
      { tag: 'v1', desc: 'One list all format', note: 'May 5 · 75 games', win: '53%' } ] },
  { id: 'ezra', leader: { set: 'ASH', number: 13, name: 'Ezra Bridger' }, base: { set: 'JTL', number: 30, name: 'Mos Eisley' },
    aspect: 'Cunning', hp: 30, games: 32, w: 20, l: 12, span: 'Jun 1 – Jun 12', who: ['rowan'],
    tags: [], size: 50, sb: 10, main: mainSample(), side: sideSample, versions: [
      { tag: 'v1', desc: 'Experience swarm', note: 'Jun 1 · 22 games', win: '64%' },
      { tag: 'v2', desc: '+2 Chopper, −1 event', note: 'Jun 8 · 10 games', win: '60%' } ] },
  { id: 'obiwan', leader: { set: 'TWI', number: 3, name: 'Obi-Wan Kenobi' }, base: { set: 'SOR', number: 20, name: 'Capital City' },
    aspect: 'Vigilance', hp: 30, games: 12, w: 8, l: 4, span: 'Jun 10 – Jun 15', who: ['drew'],
    tags: [], size: 50, sb: 10, main: mainSample(), side: sideSample, versions: [
      { tag: 'v1', desc: 'Control shell', note: 'Jun 10 · 12 games', win: '67%' } ] },
];

const UNLINKED = [
  { id: 'u1', leader: 'Baylan Skoll', base: 'Cunning base', reason: 'Partial list, 30 cards (pre-release set)', who: 'drew', date: 'Jun 21' },
  { id: 'u2', leader: 'Sabine Wren', base: 'Cunning base', reason: 'Partial list, 30 cards', who: 'sky', date: 'Jun 20' },
  { id: 'u3', leader: 'Mother Talzin', base: 'Command base', reason: 'No decklist recorded (older game)', who: 'tatum', date: 'May 12' },
  { id: 'u4', leader: 'Grand Admiral Thrawn', base: 'Aggression base', reason: 'Partial list, 42 cards', who: 'rowan', date: 'Jun 17' },
  { id: 'u5', leader: 'Aurra Sing', base: 'Aggression base', reason: 'No sideboard recorded', who: 'morg', date: 'Jun 9' },
];

const STEPS = ['Start', 'Connect Forge', 'Decks', 'Teammates', 'Confirm', 'Done'];
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const winColor = (p: number) => (p >= 58 ? tokens.color.successText : p >= 48 ? tokens.color.warn : tokens.color.dangerSoft);
const mono = tokens.led.mono;

function Reticle({ size = 20, opacity = 1 }: { size?: number; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ opacity, transition: 'opacity .5s ease', flex: '0 0 auto' }}>
      <defs><linearGradient id="kbfg" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor={FORGE} /><stop offset="1" stopColor={tokens.color.primary} /></linearGradient></defs>
      <circle cx="12" cy="12" r="8.2" stroke="url(#kbfg)" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.4" fill="url(#kbfg)" />
      <path d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2" stroke="url(#kbfg)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Small monospace pill (chip). tone: 'forge' | 'blue' | 'warn' | 'good' | default.
function Chip({ children, tone }: { children: React.ReactNode; tone?: 'forge' | 'blue' | 'warn' | 'good' }) {
  const map = {
    forge: { color: FORGE_2, border: 'rgba(239,138,60,0.4)', bg: FORGE_SOFT },
    blue: { color: tokens.color.accent, border: 'rgba(77,157,255,0.4)', bg: tokens.color.primarySoft },
    warn: { color: tokens.color.warn, border: 'rgba(224,198,74,0.4)', bg: 'transparent' },
    good: { color: tokens.color.successText, border: 'rgba(107,217,104,0.4)', bg: 'transparent' },
  } as const;
  const s = tone ? map[tone] : { color: tokens.color.textSecondary, border: tokens.color.borderStrong, bg: tokens.color.bgDeep };
  return (
    <span style={{ font: `500 11px ${mono}`, letterSpacing: '0.02em', padding: '3px 8px', borderRadius: tokens.radius.pill,
      border: `1px solid ${s.border}`, color: s.color, background: s.bg, whiteSpace: 'nowrap' }}>{children}</span>
  );
}

const microLabel: CSSProperties = { font: `600 10px ${mono}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: tokens.color.textMuted };
const statNum: CSSProperties = { font: `600 22px ${mono}`, fontVariantNumeric: 'tabular-nums' };

export default function MigrationDemo() {
  const [step, setStep] = useState(0); // -1 = migrating
  const [connected, setConnected] = useState(false);
  const [folderName, setFolderName] = useState('Core Combo Crew');
  const [deckTab, setDeckTab] = useState<'decks' | 'unlinked'>('decks');
  const [openDeck, setOpenDeck] = useState<string | null>(null);
  const [decks, setDecks] = useState(() => DECKS.map((d) => ({ ...d, include: true, name: `${d.leader.name} — ${d.aspect}` })));
  const [members, setMembers] = useState(() => MEMBERS.map((m) => ({ ...m, include: true })));
  const [consentOwn, setConsentOwn] = useState(false);
  const [consentEnc, setConsentEnc] = useState(true);
  const [migrateDone, setMigrateDone] = useState(0);

  const phase = step === -1 ? 5 : step;
  const accent = ACCENT[phase];
  const incDecks = decks.filter((d) => d.include);
  const incMembers = members.filter((m) => m.include);
  const linkedGames = incDecks.reduce((s, d) => s + d.games, 0);
  const versions = incDecks.reduce((s, d) => s + d.versions.length, 0);

  const setDeck = (id: string, patch: Partial<(typeof decks)[number]>) =>
    setDecks((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const runMigration = () => {
    setStep(-1); setMigrateDone(0);
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TOTAL = 6;
    if (reduce) { setStep(5); return; }
    let i = 0;
    const tick = () => {
      i += 1; setMigrateDone(i);
      if (i >= TOTAL) { setTimeout(() => setStep(5), 500); return; }
      setTimeout(tick, 560);
    };
    setTimeout(tick, 350);
  };

  // ── page — renders INSIDE the karabuddy app shell (real sidebar + header) ────
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 28px 64px', position: 'relative', color: tokens.color.text, fontFamily: tokens.font.family }}>
      {/* subtle progressive warm glow (the karabuddy→Forge shift, contained to this page) */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320, pointerEvents: 'none', zIndex: 0,
        background: `radial-gradient(700px 220px at 82% -30px, rgba(239,138,60,${WARM_A[phase] * 1.6}), transparent 70%)` }} />
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* page header — the SWU Forge destination + demo context (karabuddy's own chrome is the shell around this) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 20, flexWrap: 'wrap' }}>
          <Reticle opacity={DEST_OP[phase]} size={22} />
          <span style={{ font: `800 15px ${tokens.font.family}`, letterSpacing: '1.2px', textTransform: 'uppercase',
            background: 'linear-gradient(180deg,#dfe2e8 12%,#8b909c 92%)', WebkitBackgroundClip: 'text', backgroundClip: 'text',
            color: 'transparent', opacity: DEST_OP[phase], transition: 'opacity .5s ease' }}>SWU Forge</span>
          <span style={{ color: tokens.color.textSecondary, fontSize: 14 }}>Team migration</span>
          <span style={{ flex: 1 }} />
          <Chip tone="forge">Core Combo Crew</Chip>
          <Chip>Prototype · faked data</Chip>
        </div>

        {/* horizontal stepper (jump-clickable) */}
        <Stepper phase={phase} onJump={setStep} />

        {/* current step */}
        <div key={step} style={{ marginTop: 26 }}>
          {step === -1 ? <Migrating done={migrateDone} folder={folderName} decks={incDecks.length} games={linkedGames} members={incMembers.length} />
            : step === 0 ? <Start accent={accent} />
            : step === 1 ? <Connect accent={accent} connected={connected} onConnect={() => setConnected(true)} folderName={folderName} setFolderName={setFolderName} />
            : step === 2 ? <Decks accent={accent} decks={decks} setDeck={setDeck} deckTab={deckTab} setDeckTab={setDeckTab} openDeck={openDeck} setOpenDeck={setOpenDeck} versions={versions} linkedGames={linkedGames} />
            : step === 3 ? <Teammates accent={accent} members={members} setMembers={setMembers} folderName={folderName} />
            : step === 4 ? <Confirm accent={accent} decks={incDecks.length} versions={versions} games={linkedGames} members={incMembers.length} folderName={folderName} consentOwn={consentOwn} setConsentOwn={setConsentOwn} consentEnc={consentEnc} setConsentEnc={setConsentEnc} />
            : <Done accent={accent} decks={incDecks.length} versions={versions} games={linkedGames + UNLINKED.length} members={incMembers.length} folderName={folderName} onRestart={() => { setStep(0); setConnected(false); }} />}
        </div>

        {/* inline actions (steps 0–4; migrating + done carry their own) */}
        {step >= 0 && step <= 4 && (
          <Footer
            step={step} connected={connected} consentOwn={consentOwn}
            incDecks={incDecks.length} incMembers={incMembers.length} linkedGames={linkedGames} accent={accent}
            onBack={() => step > 0 && setStep(step - 1)}
            onNext={() => { if (step === 4) runMigration(); else if (step >= 0 && step < 5) setStep(step + 1); }}
          />
        )}
      </div>
    </div>
  );
}

// Horizontal, jump-clickable step indicator under the page header. The app's own
// left sidebar is the primary nav; this is just the wizard's progress.
function Stepper({ phase, onJump }: { phase: number; onJump: (i: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, borderBottom: `1px solid ${tokens.color.border}`, paddingBottom: 12 }}>
      {STEPS.map((label, i) => {
        const active = i === phase, done = i < phase;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
            <button onClick={() => onJump(i)} aria-current={active ? 'step' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: tokens.radius.md, border: 'none',
                background: active ? tokens.color.primarySoft : 'transparent', cursor: 'pointer',
                color: active ? tokens.color.text : tokens.color.textSecondary, fontFamily: tokens.font.family }}>
              <span style={{ width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center', font: `700 10px ${mono}`, flex: '0 0 auto',
                border: `1px solid ${done ? tokens.color.success : active ? tokens.led.on : tokens.color.borderStrong}`,
                background: done ? 'rgba(107,217,104,0.14)' : active ? 'rgba(77,210,255,0.14)' : 'transparent',
                color: done ? tokens.color.success : active ? tokens.led.on : tokens.color.textMuted,
                boxShadow: active ? tokens.led.dotGlow : 'none' }}>{done ? '✓' : i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 500 }}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden style={{ width: 14, height: 1, background: tokens.color.border }} />}
          </div>
        );
      })}
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
function Eyebrow({ accent, children }: { accent: string; children: React.ReactNode }) {
  return <div style={{ font: `600 11px ${mono}`, letterSpacing: '0.2em', textTransform: 'uppercase', color: accent, marginBottom: 10, transition: 'color .4s' }}>{children}</div>;
}
function Title({ children }: { children: React.ReactNode }) {
  return <h1 style={{ fontSize: 29, lineHeight: 1.16, margin: '0 0 12px', letterSpacing: '-0.4px', fontWeight: 700, textWrap: 'balance' } as CSSProperties}>{children}</h1>;
}
function Lede({ children }: { children: React.ReactNode }) {
  return <p style={{ color: tokens.color.textSecondary, fontSize: 15, maxWidth: '64ch', margin: '0 0 26px' }}>{children}</p>;
}
function StatStrip({ items }: { items: { v: React.ReactNode; k: string; color?: string }[] }) {
  return (
    <div style={{ display: 'flex', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, overflow: 'hidden', marginBottom: 22, background: tokens.color.surface }}>
      {items.map((it, i) => (
        <div key={i} style={{ flex: 1, padding: '14px 16px', borderRight: i < items.length - 1 ? `1px solid ${tokens.color.border}` : undefined }}>
          <div style={{ ...statNum, color: it.color ?? tokens.color.text }}>{it.v}</div>
          <div style={{ ...microLabel, marginTop: 2 }}>{it.k}</div>
        </div>
      ))}
    </div>
  );
}
function primaryBtn(accent: string, ember = false): CSSProperties {
  return { ...glowButtonStyle, padding: '10px 18px', fontSize: 14,
    color: ember ? '#ffe7d6' : tokens.color.accent,
    border: `1px solid ${ember ? FORGE : tokens.color.primary}`,
    boxShadow: ember ? `0 0 12px ${FORGE_SOFT}, inset 0 0 8px rgba(239,138,60,0.10)` : tokens.button.glow };
}

// ── steps ────────────────────────────────────────────────────────────────────
function Start({ accent }: { accent: string }) {
  const vals = [
    ['Full decklists', "Each game keeps the recorder's whole 50 plus sideboard, so decks arrive complete, not leader-and-base stubs."],
    ['Versions', 'Games group into the versions you ran over time, each with its own win rate.'],
    ['Records', 'Every deck comes with its win-loss, its win rate, and who on the team played it.'],
    ['Battle logs', 'All 412 games upload as replays you can watch on SWU Forge.'],
  ];
  return (
    <>
      <Eyebrow accent={accent}>karabuddy → SWU Forge</Eyebrow>
      <Title>Move your team's decks and games to SWU Forge</Title>
      <Lede>Your team has <b>412</b> recorded games. karabuddy stores the full decklist behind each one, so it can rebuild them as SWU Forge decks (with the versions you ran and their win rates) and bring every game across as a battle log.</Lede>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        {vals.map(([h, p]) => (
          <Panel key={h} hud={false} padding={16}>
            <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 3 }}>{h}</div>
            <div style={{ color: tokens.color.textSecondary, fontSize: 13 }}>{p}</div>
          </Panel>
        ))}
      </div>
      <p style={{ color: tokens.color.textMuted, fontSize: 13 }}>Nothing leaves karabuddy until you review and confirm.</p>
    </>
  );
}

function Connect({ accent, connected, onConnect, folderName, setFolderName }: { accent: string; connected: boolean; onConnect: () => void; folderName: string; setFolderName: (v: string) => void }) {
  if (!connected) {
    return (
      <>
        <Eyebrow accent={accent}>Connect</Eyebrow>
        <Title>Connect your SWU Forge account</Title>
        <Lede>You and your teammates sign in to both apps with Google or Discord. We use that to match each player to their Forge account, so no one has to link anything by hand.</Lede>
        <Panel padding={20} style={{ maxWidth: 440 }}>
          <TacticalHeading>Sign in to SWU Forge as team owner</TacticalHeading>
          <button onClick={onConnect} style={{ ...btnGhost, width: '100%', padding: '10px', marginBottom: 9, fontSize: 14 }}>Continue with Google</button>
          <button onClick={onConnect} style={{ ...btnGhost, width: '100%', padding: '10px', fontSize: 14 }}>Continue with Discord</button>
        </Panel>
        <p style={{ color: tokens.color.textMuted, fontSize: 12, marginTop: 14 }}>Faked for the prototype. Nothing leaves this page.</p>
      </>
    );
  }
  return (
    <>
      <Eyebrow accent={accent}>Connected</Eyebrow>
      <Title>Connected as Drew</Title>
      <Lede>Matched <b>drew.knox@gmail.com</b> to the Forge account <b>@drewknox</b>. Choose where your team's decks and games should go.</Lede>
      <Panel padding={20} style={{ maxWidth: 560 }}>
        <TacticalHeading>SWU Forge team folder</TacticalHeading>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input value={folderName} onChange={(e) => setFolderName(e.target.value)} spellCheck={false}
            style={{ flex: 1, background: tokens.color.bgDeep, border: `1px solid ${tokens.color.borderStrong}`, color: tokens.color.text,
              borderRadius: tokens.radius.md, padding: '9px 11px', fontSize: 14, fontFamily: tokens.font.family }} />
          <Chip tone="forge">new folder</Chip>
        </div>
        <div style={{ ...microLabel, textTransform: 'none', letterSpacing: '0.02em', marginTop: 8 }}>swuforge.com/folders/new · 6 teammates invited</div>
      </Panel>
    </>
  );
}

function Decks({ accent, decks, setDeck, deckTab, setDeckTab, openDeck, setOpenDeck, versions, linkedGames }: any) {
  return (
    <>
      <Eyebrow accent={accent}>Decks</Eyebrow>
      <Title>Decks built from your games</Title>
      <StatStrip items={[
        { v: decks.filter((d: any) => d.include).length, k: 'Decks', color: accent },
        { v: versions, k: 'Versions' },
        { v: linkedGames, k: 'Games linked', color: tokens.led.on },
        { v: UNLINKED.length, k: 'Standalone games' },
      ]} />
      <div style={{ marginBottom: 16 }}>
        <Segmented value={deckTab} onChange={setDeckTab} variant="pill" size="md"
          options={[['decks', `Decks · ${decks.length}`], ['unlinked', `Standalone games · ${UNLINKED.length}`]]} />
      </div>
      {deckTab === 'decks' ? (
        <>
          <p style={{ color: tokens.color.textMuted, fontSize: 13, margin: '-4px 0 14px' }}>Rename a deck, turn one off, or open it to see the list, versions, and games. All on by default.</p>
          {decks.map((d: any) => <DeckRow key={d.id} d={d} setDeck={setDeck} open={openDeck === d.id} onToggleOpen={() => setOpenDeck(openDeck === d.id ? null : d.id)} />)}
        </>
      ) : (
        <>
          <p style={{ color: tokens.color.textMuted, fontSize: 13, margin: '-4px 0 14px' }}>These games don't have a full decklist (partial pre-release captures, or games recorded before karabuddy stored lists). They come across as standalone battle logs you can watch now and attach to a deck later.</p>
          {UNLINKED.map((u) => (
            <Panel key={u.id} hud={false} padding={0} style={{ marginBottom: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 15px' }}>
                <LeaderBasePair leader={{ name: u.leader }} base={{ name: u.base }} orientation="overlap" width={34} height={26} fit="cover" radius={4} fallback="box" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{u.leader} · {u.base}</div>
                  <div style={{ ...microLabel, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip tone="warn">no full deck</Chip> {u.reason} · {u.date}
                  </div>
                </div>
                <select defaultValue="keep" style={{ background: tokens.color.bgDeep, color: tokens.color.textSecondary, border: `1px solid ${tokens.color.borderStrong}`, borderRadius: tokens.radius.sm, fontFamily: tokens.font.family, fontSize: 13, padding: '6px 10px' }}>
                  <option value="keep">Keep standalone</option>
                  {DECKS.map((d) => <option key={d.id} value={d.id}>Attach to {d.leader.name}</option>)}
                </select>
              </div>
            </Panel>
          ))}
        </>
      )}
    </>
  );
}

function DeckRow({ d, setDeck, open, onToggleOpen }: any) {
  const wr = Math.round((d.w / (d.w + d.l)) * 100);
  const ro = (v: React.ReactNode, k: string, color?: string) => (
    <div style={{ textAlign: 'right' }}>
      <div style={{ font: `600 15px ${mono}`, fontVariantNumeric: 'tabular-nums', color: color ?? tokens.color.text }}>{v}</div>
      <div style={{ font: `400 9px ${mono}`, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.color.textMuted }}>{k}</div>
    </div>
  );
  return (
    <Panel hud={false} padding={0} style={{ marginBottom: 10, opacity: d.include ? 1 : 0.5, borderColor: d.include ? 'rgba(239,138,60,0.26)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 15, padding: '12px 15px' }}>
        <LeaderBasePair leader={d.leader} base={d.base} orientation="overlap" width={40} height={30} fit="cover" radius={4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <input value={d.name} onChange={(e) => setDeck(d.id, { name: e.target.value })} spellCheck={false}
            style={{ font: `650 15px ${tokens.font.family}`, color: tokens.color.text, background: 'transparent', border: '1px solid transparent',
              borderRadius: 4, padding: '1px 4px', margin: '-1px -4px', width: '100%', maxWidth: 340 }} />
          <div style={{ ...microLabel, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: tokens.color.textMuted }}>
            <span style={{ color: tokens.color.textSecondary }}>{d.leader.name} · {d.hp}HP {d.aspect}</span>
            {d.versions.length > 1 && <Chip tone="forge">{d.versions.length} versions</Chip>}
            {d.tags.map((t: string) => <Chip key={t} tone="blue">{t}</Chip>)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {ro(d.games, 'games')}
          {ro(`${d.w}–${d.l}`, 'W–L')}
          {ro(`${wr}%`, 'win', winColor(wr))}
          <button onClick={onToggleOpen} aria-label="Expand" style={{ background: 'none', border: 'none', color: tokens.color.textMuted, cursor: 'pointer', font: `12px ${mono}`, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s' }}>▶</button>
          <LedToggle checked={d.include} onChange={(v) => setDeck(d.id, { include: v })} label="Include" variant="inline" />
        </div>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${tokens.color.border}`, padding: 16, background: 'rgba(10,8,16,0.3)' }}>
          <TacticalHeading>Versions</TacticalHeading>
          {d.versions.map((v: Version) => (
            <div key={v.tag} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.sm, background: tokens.color.surface, marginBottom: 7 }}>
              <span style={{ font: `700 13px ${mono}`, color: FORGE_2, width: 32 }}>{v.tag}</span>
              <div style={{ flex: 1, fontSize: 13 }}>{v.desc}<span style={{ display: 'block', color: tokens.color.textMuted, font: `12px ${mono}`, marginTop: 2 }}>{v.note}</span></div>
              <span style={{ font: `12px ${mono}`, color: tokens.color.textSecondary }}>{v.win} win</span>
            </div>
          ))}
          <div style={{ marginTop: 16 }}><TacticalHeading>Decklist · {d.size} + {d.sb} sideboard</TacticalHeading></div>
          <CardCols cards={d.main} more={d.size - d.main.reduce((s: number, c: any) => s + c.q, 0)} />
          <div style={{ marginTop: 14 }}><TacticalHeading>Sideboard</TacticalHeading></div>
          <CardCols cards={d.side} />
          <div style={{ marginTop: 14 }}><TacticalHeading>Played by</TacticalHeading></div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {d.who.map((id: string) => { const m = MEMBERS.find((x) => x.id === id)!; return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: tokens.color.textSecondary }}>
                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', font: `700 10px ${mono}`, color: tokens.color.bgDeep, background: m.av }}>{initials(m.name)}</span>{m.name}</span>
            ); })}
          </div>
        </div>
      )}
    </Panel>
  );
}
function CardCols({ cards, more }: { cards: { c: number; q: number; n: string }[]; more?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 22px', marginTop: 4 }}>
      {cards.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, padding: '2px 0' }}>
          <span style={{ font: `700 11px ${mono}`, width: 19, height: 19, borderRadius: 4, display: 'grid', placeItems: 'center', background: tokens.color.bgDeep, border: `1px solid ${tokens.color.borderStrong}`, color: tokens.color.textSecondary }}>{c.c}</span>
          <span style={{ font: `12px ${mono}`, color: tokens.color.textMuted }}>{c.q}×</span>
          <span>{c.n}</span>
        </div>
      ))}
      {more != null && more > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, padding: '2px 0' }}>
          <span style={{ font: `700 11px ${mono}`, width: 19, textAlign: 'center', color: tokens.color.textMuted }}>…</span>
          <span style={{ color: tokens.color.textMuted, fontStyle: 'italic' }}>+ {more} more maindeck cards</span>
        </div>
      )}
    </div>
  );
}

function Teammates({ accent, members, setMembers, folderName }: any) {
  const toggle = (id: string) => setMembers((prev: any[]) => prev.map((m) => (m.id === id ? { ...m, include: !m.include } : m)));
  return (
    <>
      <Eyebrow accent={accent}>Teammates</Eyebrow>
      <Title>Teammates</Title>
      <Lede>Matched teammates go into the <b>{folderName}</b> folder with their games credited to them. Anyone without a Forge account gets an invite, and their games wait in the folder until they claim it.</Lede>
      {members.map((m: any) => (
        <Panel key={m.id} hud={false} padding={0} style={{ marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 15px' }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', font: `700 13px ${mono}`, color: tokens.color.bgDeep, background: m.av }}>{initials(m.name)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{m.name} {m.role === 'Owner' && <Chip>owner</Chip>}</div>
              <div style={{ ...microLabel, textTransform: 'none', letterSpacing: '0.02em', marginTop: 3, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: m.provider === 'google' ? '#8ab4f8' : '#a9b3f2' }}>{m.provider}</span>
                {m.matched ? <Chip tone="good">matched · {m.email}</Chip> : <Chip tone="warn">no Forge account yet</Chip>}
                · {m.games} games
              </div>
            </div>
            {!m.matched && <button style={{ ...btnGhost, padding: '6px 12px' }}>Invite</button>}
            <LedToggle checked={m.include} onChange={() => toggle(m.id)} label="Include" variant="inline" />
          </div>
        </Panel>
      ))}
    </>
  );
}

function Confirm({ accent, decks, versions, games, members, folderName, consentOwn, setConsentOwn, consentEnc, setConsentEnc }: any) {
  const consent = (checked: boolean, set: (v: boolean) => void, title: string, sub: string) => (
    <Panel hud={false} padding={0} style={{ marginBottom: 9 }}>
      <div style={{ padding: '11px 14px' }}>
        <LedToggle checked={checked} onChange={set} label={title} variant="inline" />
        <div style={{ color: tokens.color.textMuted, fontSize: 12, marginTop: 4, marginLeft: 21 }}>{sub}</div>
      </div>
    </Panel>
  );
  return (
    <>
      <Eyebrow accent={accent}>Confirm</Eyebrow>
      <Title>Review and migrate</Title>
      <Lede>This is what gets added to your SWU Forge folder <b>{folderName}</b>. It only adds to Forge and changes nothing in karabuddy.</Lede>
      <StatStrip items={[
        { v: decks, k: `Decks + ${versions} versions`, color: accent },
        { v: games, k: 'Linked games', color: tokens.led.on },
        { v: UNLINKED.length, k: 'Standalone games' },
        { v: members, k: 'Teammates' },
      ]} />
      <TacticalHeading>Before you send</TacticalHeading>
      {consent(consentOwn, setConsentOwn, "These are my team's own recorded games", "Only each player's own decks and games are sent. Opponents' hidden cards were never recorded.")}
      {consent(consentEnc, setConsentEnc, 'Leave out private (encrypted) team replays', "Encrypted replays can't be read on the server, so they stay in karabuddy.")}
    </>
  );
}

function Migrating({ done, folder, decks, games, members }: { done: number; folder: string; decks: number; games: number; members: number }) {
  const rows = [
    `Creating the team folder "${folder}"`, `Building ${decks} decks and versions`,
    `Uploading ${games} games as battle logs`, 'Attaching games to their decks',
    `Crediting games to ${members} teammates`, 'Working out win rates and matchups',
  ];
  return (
    <div style={{ maxWidth: 520, margin: '6vh auto 0', textAlign: 'center' }}>
      <div style={{ width: 92, height: 92, margin: '0 auto 26px', borderRadius: '50%',
        border: `3px solid rgba(77,210,255,0.18)`, borderTopColor: FORGE, borderRightColor: tokens.color.primary,
        animation: 'kbspin 1s linear infinite', boxShadow: `0 0 16px ${FORGE_SOFT}` }} />
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Setting up your team on SWU Forge</h1>
      <p style={{ color: tokens.color.textMuted, font: `13px ${mono}` }}>Nothing in karabuddy changes.</p>
      <div style={{ textAlign: 'left', marginTop: 24, font: `13px ${mono}` }}>
        {rows.map((t, i) => {
          const state = i < done ? 'done' : i === done ? 'run' : 'todo';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 0',
              color: state === 'todo' ? tokens.color.textMuted : state === 'run' ? tokens.color.text : tokens.color.textSecondary,
              opacity: state === 'todo' ? 0.4 : 1, transition: '.3s' }}>
              <span style={{ width: 16, textAlign: 'center', color: state === 'run' ? tokens.led.on : tokens.color.success }}>{state === 'done' ? '✓' : state === 'run' ? '◐' : '○'}</span>{t}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes kbspin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[style*="kbspin"]{animation:none!important}}`}</style>
    </div>
  );
}

function Done({ accent, decks, versions, games, members, folderName, onRestart }: any) {
  return (
    <>
      <div style={{ textAlign: 'center', padding: '12px 0 22px' }}>
        <div style={{ width: 64, height: 64, margin: '0 auto 18px', borderRadius: 16, display: 'grid', placeItems: 'center',
          background: tokens.color.surface, border: `2px solid transparent`, boxShadow: `0 0 16px ${FORGE_SOFT}`,
          backgroundImage: `linear-gradient(${tokens.color.surface},${tokens.color.surface}), linear-gradient(100deg,${FORGE},${tokens.color.primary})`,
          backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke={FORGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <Title>Your team is set up on SWU Forge</Title>
        <Lede>Everything below is live in <b>{folderName}</b>. The decks are ready to edit, the games are ready to watch, and the records are in place. karabuddy keeps every original.</Lede>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, margin: '10px 0 22px' }}>
        {[[decks, 'Decks'], [versions, 'Versions'], [games, 'Games'], [members, 'Teammates']].map(([v, k]) => (
          <Panel key={k as string} hud={false} padding={14} style={{ textAlign: 'center' }}>
            <div style={{ font: `600 24px ${mono}`, color: accent }}>{v}</div>
            <div style={{ ...microLabel, marginTop: 3 }}>{k}</div>
          </Panel>
        ))}
      </div>
      <Panel hud={false} padding={16} style={{ background: `linear-gradient(110deg, ${FORGE_SOFT}, ${tokens.color.primarySoft})`, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <LeaderBasePair leader={{ set: 'ASH', number: 11, name: '' }} base={{ set: 'SOR', number: 21, name: '' }} orientation="overlap" width={30} height={22} fit="cover" radius={3} fallback="box" />
        <div style={{ flex: 1 }}>
          <b>karabuddy and SWU Forge, together</b>
          <div style={{ color: tokens.color.textMuted, fontSize: 13, marginTop: 3 }}>New karabuddy games keep flowing to Forge. And your Forge battle logs open in the karabuddy viewer, so you can review with tags and frames while you build on the Forge.</div>
        </div>
      </Panel>
      <div style={{ display: 'flex', gap: 12, marginTop: 22 }}>
        <button style={{ ...primaryBtn(accent, true), flex: 1, textAlign: 'center' }}>Open {folderName} in SWU Forge ↗</button>
        <button onClick={onRestart} style={{ ...btnGhost, padding: '10px 16px' }}>Run again</button>
      </div>
    </>
  );
}

function Footer({ step, connected, consentOwn, incDecks, incMembers, linkedGames, accent, onBack, onNext }: any) {
  const cfg: Record<number, { label: string; hint: string; ok: boolean; ember?: boolean; hide?: boolean }> = {
    0: { label: 'Start migration →', hint: '', ok: true },
    1: { label: connected ? 'Continue →' : 'Connect an account to continue', hint: '', ok: connected },
    2: { label: 'Continue →', hint: `${incDecks} decks · ${linkedGames} games selected`, ok: incDecks > 0 },
    3: { label: 'Continue →', hint: `${incMembers} teammates`, ok: incMembers > 0 },
    4: { label: 'Migrate to SWU Forge', hint: consentOwn ? '' : 'Confirm the first box to continue', ok: consentOwn, ember: true },
    5: { label: '', hint: '', ok: true, hide: true },
  };
  const c = cfg[step];
  return (
    <div style={{ marginTop: 30, paddingTop: 18, borderTop: `1px solid ${tokens.color.border}`, display: 'flex', alignItems: 'center', gap: 14 }}>
      <button onClick={onBack} style={{ ...btnGhost, border: 'none', visibility: step <= 0 ? 'hidden' : 'visible' }}>← Back</button>
      <span style={{ color: tokens.color.textMuted, font: `13px ${mono}` }}>{c.hint}</span>
      <span style={{ flex: 1 }} />
      {!c.hide && (
        <button onClick={onNext} disabled={!c.ok}
          style={{ ...primaryBtn(accent, c.ember), opacity: c.ok ? 1 : 0.4, cursor: c.ok ? 'pointer' : 'not-allowed', boxShadow: c.ok ? primaryBtn(accent, c.ember).boxShadow : 'none' }}>
          {c.label}
        </button>
      )}
    </div>
  );
}
