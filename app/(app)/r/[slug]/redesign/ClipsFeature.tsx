'use client';

import { tokens } from '@/app/_theme/karabuddyTokens';
import { ClipsList, type ClipSummary } from '../ClipsList';
import { Icon } from './icons';

// B216 redesign — the Clips sidebar view: existing clips on this replay + a
// button to open the clip trim builder (the rail's Clip icon does the same).
export function ClipsFeature({ clips, onCreate, canCreate }: { clips: ClipSummary[]; onCreate: () => void; canCreate: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 14px 28px', color: tokens.color.text }}>
      {canCreate && (
        <button type="button" onClick={onCreate}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800, color: tokens.color.primary, background: 'rgba(77,157,255,0.14)', border: `1px solid ${tokens.color.primary}` }}>
          <span style={{ display: 'inline-flex' }}>{Icon.clip}</span> New clip from here
        </button>
      )}
      {clips.length === 0 ? (
        <div style={{ padding: '18px 4px', textAlign: 'center', color: tokens.color.textMuted, fontSize: 13 }}>No clips on this replay yet.</div>
      ) : (
        <ClipsList clips={clips} />
      )}
    </div>
  );
}
