import type { ReactNode } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { FULL_NOTE_PATH, KARABUDDY_DISCORD_URL, SWU_FORGE_DISCORD_URL } from './constants';


function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: tokens.forge.softText, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
      {children}
    </a>
  );
}

function Tbd({ children }: { children: ReactNode }) {
  return <mark style={{ background: 'rgba(232, 132, 47, 0.18)', color: tokens.forge.markOrange, padding: '0 3px', borderRadius: 3 }}>[TBD: {children}]</mark>;
}

export const headline = 'A note about KaraBuddy and SWU Forge';

export const lede: ReactNode = (
  <>
    Hi everyone,
    <br />
    <br />
    As some of you know, I joined SWU Forge a few months ago, and most of my development time has gone there since. I
    want to be upfront about what that means for KaraBuddy.
  </>
);

export interface Section {
  id: 'karabuddy' | 'hosting' | 'why' | 'forge' | 'move' | 'roadmap' | 'feedback';
  heading: string;
  short?: ReactNode;
  bullets?: ReactNode[];
  more?: ReactNode;
}

export const sections: Section[] = [
  {
    id: 'karabuddy',
    heading: 'The plan for KaraBuddy',
    short: (
      <>
        KaraBuddy will keep running as it is through the Homeworlds and Icons sets, and I&apos;ll fix what breaks. When
        Legacy of Skywalker releases in 2027, I&apos;ll retire it, so I can put my full effort into making SWU Forge as
        good as it can possibly be.
      </>
    ),
  },
  {
    id: 'move',
    heading: 'Bring your team over',
    short: (
      <>
        You don&apos;t have to wait until then. If you run a team, you can move it today. You pick everyone&apos;s role,
        each teammate gets an email invitation, and your KaraBuddy team stays as it is. You&apos;ll need a SWU Forge
        account with the same email.
      </>
    ),
  },
  {
    id: 'why',
    heading: "Why I'm doing this",
    short: (
      <>
        I built KaraBuddy fast, on shaky technical ground, to get something useful out to the community, and that has
        caught up with it. When Karabast changes, its extension-based recording and its modified copy of an old Karabast
        client often break. SWU Forge is built on a foundation that can keep up, and we&apos;re working on
        linking Karabast accounts to it directly, so you won&apos;t need an extension at all.
      </>
    ),
  },
  {
    id: 'forge',
    heading: 'Replays, and a lot more',
    short: (
      <>
        Replays are the heart of KaraBuddy, and SWU Forge does them better. The first thing I did when I joined SWU Forge
        was rewrite its replay viewer from the ground up, using everything I learned building KaraBuddy to make it even
        better. You can share any match with your team or with anyone who has the link.
      </>
    ),
    bullets: [
      <>
        More accurate, more useful matchup and deck stats. Every game is tied to the exact deck version you played in
        the deck builder, which KaraBuddy, with no decks of its own, could never do.
      </>,
      <>A built-in deck builder with card search, versions and public decks.</>,
      <>Teams with shared deck folders and replay reviews.</>,
    ],
  },
  {
    id: 'roadmap',
    heading: 'Coming next',
    bullets: [
      <>Collection management, to track the cards you own.</>,
      <Tbd>keep &quot;import KaraBuddy replays&quot;? planned, not built</Tbd>,
      <Tbd>more roadmap items?</Tbd>,
    ],
  },
  {
    id: 'feedback',
    heading: "Tell me what you'd miss",
    short: (
      <>
        If SWU Forge is missing something you love about KaraBuddy, tell me in the{' '}
        <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> or the{' '}
        <Ext href={SWU_FORGE_DISCORD_URL}>SWU Forge Discord</Ext>, and I&apos;ll try to bring it over before 2027.
      </>
    ),
  },
];

export const moveCopy = {
  ownerIntro: (count: number) => (count === 1 ? 'You own this team:' : 'You own these teams:'),
  ownerLink: 'Move to SWU Forge',
  memberOnly: "Your team's owner can move your team, and you'll get an email invitation.",
  memberToo: "For teams you don't own, the owner can move them.",
  signedOut: (
    <>
      <Link href={`/signin?callbackUrl=${FULL_NOTE_PATH}`} style={{ color: tokens.forge.softText, fontWeight: 600 }}>
        Sign in
      </Link>{' '}
      to see the teams you can move.
    </>
  ),
};

export const actions = {
  primary: 'Open SWU Forge',
  fullNote: 'Read the full note',
  close: 'Close',
};

export const signOff: ReactNode = (
  <>
    Thank you for everything you&apos;ve put into KaraBuddy. I hope to see you on SWU Forge.
    <br />
    <br />
    Parker
  </>
);
