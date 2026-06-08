/* eslint-disable @next/next/no-img-element */
// B113: the Satori-rendered "moment card" for the OG unfurl. Pure presentation
// over a MomentCardModel + a map of art-URL -> png data-URL (Satori can't embed
// webp, so the route pre-converts each card to png; a missing entry falls back
// to a text tile). The layout mirrors the karabast board: each player is a row
// with the SPACE arena on the left, the LEADER + BASE in the centre (the
// matchup headline), and the GROUND arena on the right — opponent on top, POV on
// the bottom, VS between. The two rows grow to fill the 630px card.
// Satori CSS is a subset: every multi-child node sets display:flex, images carry
// explicit width/height, spacing via margins. `measure` disables the row
// flexGrow so the natural (min-content) height can be measured offline.
import type { MomentCardModel, SideModel, UnitModel } from '@/lib/momentCard';

const C = {
  bg: '#0e1116',
  panel: '#171d27',
  line: 'rgba(77,157,255,0.22)',
  accent: '#4d9dff',
  text: '#eef2f8',
  muted: '#9aa3b2',
  faint: '#6c7588',
  damage: '#ff5a4d',
};

// Leaders + bases are LANDSCAPE cards (3.5×2.5); units are portrait. Sized so
// the WHOLE card fits 630px — verified by measuring rendered content height.
const LEAD_W = 156;
const LEAD_H = 112;
const UNIT_W = 74;
const UNIT_H = 104;
const CENTER_W = 344;

function DamagePip({ value, size = 22 }: { value: number; size?: number }) {
  return (
    <div style={{
      position: 'absolute', top: 3, right: 3, width: size, height: size, borderRadius: size,
      background: C.damage, color: '#fff', display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 13, fontWeight: 800, border: '2px solid #0e1116',
    }}>{value}</div>
  );
}

function CardImg({ dataUrl, name, w, h, damage, exhausted, power, hp }: {
  dataUrl?: string; name: string; w: number; h: number; damage: number; exhausted?: boolean; power?: number | null; hp?: number | null;
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', width: w, height: h }}>
      {dataUrl ? (
        <img src={dataUrl} width={w} height={h} style={{ borderRadius: 7, opacity: exhausted ? 0.5 : 1 }} />
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', width: w, height: h, borderRadius: 7,
          background: '#202836', border: '1px solid rgba(255,255,255,0.08)', padding: 5,
          justifyContent: 'space-between', opacity: exhausted ? 0.5 : 1,
        }}>
          <div style={{ display: 'flex', fontSize: 11, color: C.text, lineHeight: 1.1 }}>{name.slice(0, 26)}</div>
          {(power != null || hp != null) && (
            <div style={{ display: 'flex', fontSize: 14, fontWeight: 700, color: C.muted }}>{power ?? '–'}/{hp ?? '–'}</div>
          )}
        </div>
      )}
      {damage > 0 && <DamagePip value={damage} />}
    </div>
  );
}

// One arena column (GROUND or SPACE). `side='right'` hugs the centre from the
// right (units flush left); `side='left'` hugs from the left (units flush right).
function Arena({ label, units, extra, align, art }: {
  label: string; units: UnitModel[]; extra: number; align: 'left' | 'right'; art: Map<string, string>;
}) {
  const tiles = (
    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: align === 'left' ? 'flex-end' : 'flex-start' }}>
      {units.map((u, i) => (
        <div key={i} style={{ display: 'flex', margin: '0 4px 4px 4px' }}>
          <CardImg dataUrl={art.get(u.artUrl)} name={u.name} w={UNIT_W} h={UNIT_H} damage={u.damage} exhausted={u.exhausted} power={u.power} hp={u.hp} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: UNIT_H, margin: '0 4px', color: C.muted, fontSize: 16 }}>+{extra}</div>
      )}
      {units.length === 0 && extra === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', height: UNIT_H, color: C.faint, fontSize: 14 }}>—</div>
      )}
    </div>
  );
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flexGrow: 1, width: 0,
      alignItems: align === 'left' ? 'flex-end' : 'flex-start',
    }}>
      <div style={{ display: 'flex', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: C.faint, marginBottom: 4 }}>{label}</div>
      {tiles}
    </div>
  );
}

function PlayerRow({ side, art, grow }: { side: SideModel; art: Map<string, string>; grow: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', ...(grow ? { flexGrow: 1 } : {}) }}>
      {/* SPACE arena — left */}
      <Arena label="SPACE" units={side.space} extra={side.extraSpace} align="left" art={art} />

      {/* centre — leader + base, the matchup headline */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', width: CENTER_W,
        marginLeft: 14, marginRight: 14,
      }}>
        <div style={{ display: 'flex' }}>
          <div style={{ display: 'flex', marginRight: 6 }}>
            <CardImg dataUrl={side.leader ? art.get(side.leader.artUrl) : undefined} name={side.leader?.name ?? ''} w={LEAD_W} h={LEAD_H} damage={side.leader?.damage ?? 0} />
          </div>
          <CardImg dataUrl={side.base ? art.get(side.base.artUrl) : undefined} name={side.base?.name ?? ''} w={LEAD_W} h={LEAD_H} damage={side.base?.damage ?? 0} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
          <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, color: C.accent }}>{side.name}</div>
          <div style={{ display: 'flex', fontSize: 12, color: C.faint, marginLeft: 10 }}>hand {side.handCount} · res {side.availableResources}</div>
        </div>
        <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.1, marginTop: 3, textAlign: 'center' }}>{side.leader?.name ?? '—'}</div>
        <div style={{ display: 'flex', fontSize: 14, fontWeight: 600, color: C.muted, marginTop: 1 }}>{side.base?.name ?? '—'}</div>
      </div>

      {/* GROUND arena — right */}
      <Arena label="GROUND" units={side.ground} extra={side.extraGround} align="right" art={art} />
    </div>
  );
}

export function MomentCard({ model, art, measure }: { model: MomentCardModel; art: Map<string, string>; measure?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
      background: C.bg, color: C.text, padding: 24, fontFamily: 'Barlow, sans-serif',
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, letterSpacing: 1 }}>
          <span style={{ color: C.text }}>KARA</span><span style={{ color: C.accent }}>BUDDY</span>
        </div>
        <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 19, fontWeight: 600, color: C.muted }}>
          {model.roundLabel} · {model.frameLabel}
        </div>
      </div>

      <PlayerRow side={model.matchup.top} art={art} grow={!measure} />

      {/* VS divider */}
      <div style={{ display: 'flex', alignItems: 'center', margin: '6px 0' }}>
        <div style={{ display: 'flex', flexGrow: 1, height: 2, background: C.line }} />
        <div style={{ display: 'flex', margin: '0 14px', fontSize: 17, fontWeight: 800, color: C.faint, letterSpacing: 2 }}>VS</div>
        <div style={{ display: 'flex', flexGrow: 1, height: 2, background: C.line }} />
      </div>

      <PlayerRow side={model.matchup.bottom} art={art} grow={!measure} />

      {/* tag */}
      {model.tagLine && (
        <div style={{
          display: 'flex', marginTop: 6, padding: '7px 14px', borderRadius: 8,
          background: C.panel, border: `1px solid ${C.line}`, fontSize: 20, color: C.text,
        }}>
          “{model.tagLine}”
        </div>
      )}
    </div>
  );
}
