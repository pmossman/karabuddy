'use client';

import Link from 'next/link';
import { useState } from 'react';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { ForgeMark } from '@/app/_components/forgeAnnouncement/ForgeMark';
import { MovedGuidance, forgeButton, inlineLink } from '@/app/_components/forgeAnnouncement/ForgeAnnouncementBody';
import { movedCopy } from '@/app/_components/forgeAnnouncement/copy';
import { FORGE_MOVED_HIDDEN_COOKIE } from '@/app/_components/forgeAnnouncement/constants';

const f = tokens.forge;

export function ForgeMovedBanner({
  slug,
  teamName,
  url,
  movedOn,
  owner,
  inviteHref,
}: {
  slug: string;
  teamName: string;
  url: string;
  movedOn: string;
  owner: boolean;
  inviteHref: string | null;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  const hide = () => {
    document.cookie = `${FORGE_MOVED_HIDDEN_COOKIE}=1; path=/teams/${encodeURIComponent(slug)}; samesite=lax`;
    setHidden(true);
  };

  return (
    <section
      aria-labelledby="forge-moved-title"
      data-testid="forge-moved-banner"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, margin: '0 0 18px', padding: '12px 14px', background: f.surface, border: `1px solid ${f.softBorder}`, borderRadius: f.radius, fontFamily: f.font, color: f.text }}
    >
      <span style={{ marginTop: 1 }}>
        <ForgeMark size={22} />
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px 16px' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div id="forge-moved-title" style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.35 }}>
            {owner ? movedCopy.ownerTitle(teamName, movedOn) : movedCopy.title(teamName)}
          </div>
          {!owner && <MovedGuidance style={{ margin: '4px 0 0', fontSize: 13 }} />}
          {owner && inviteHref && (
            <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.6, opacity: 0.86 }}>
              <Link href={inviteHref} style={inlineLink}>
                {movedCopy.ownerInvite}
              </Link>
              {movedCopy.ownerInviteRest}
            </p>
          )}
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="kbf-primary" style={{ ...forgeButton, padding: '7px 13px', fontSize: 13 }}>
          {movedCopy.open}
        </a>
      </div>
      <button type="button" onClick={hide} aria-label={movedCopy.hide} title={movedCopy.hide} className="kbf-quiet" style={{ ...forgeButton, padding: 6, marginTop: -2 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
