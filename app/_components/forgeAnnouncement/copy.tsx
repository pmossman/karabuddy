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
    As some of you know, I joined SWU Forge a few months ago. It started when I got chatting with @InvisibleLuis, SWU
    Forge&apos;s sole developer, about building community tools. We realized how aligned we are on the community, user
    privacy and building software, so when he asked if I&apos;d like to work on it with him, I said yes. Here&apos;s what
    that means for KaraBuddy.
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
        KaraBuddy will run as it is through the Homeworlds and Icons sets, and I&apos;ll fix what breaks. When
        Legacy of Skywalker releases in 2027, I&apos;ll retire it and put my full effort into SWU Forge.
      </>
    ),
  },
  {
    id: 'move',
    heading: 'Bring your team over',
    short: (
      <>
        You don&apos;t have to wait until 2027. If you run a team, you can move it today. You pick everyone&apos;s role,
        each teammate gets an email invitation, and your KaraBuddy team stays as it is.
      </>
    ),
  },
  {
    id: 'why',
    heading: "Why I'm doing this",
    short: (
      <>
        I built KaraBuddy fast, on shaky technical ground, and Karabast&apos;s changes keep breaking its extension recording
        and its old, modified Karabast client. SWU Forge is built to keep up, and a direct Karabast account link is
        coming, so you won&apos;t need an extension.
      </>
    ),
  },
  {
    id: 'forge',
    heading: 'Replays, and more',
    short: (
      <>
        Replays are the heart of KaraBuddy, and SWU Forge does them better. The first thing I did there was rewrite its
        replay viewer from the ground up, using everything KaraBuddy taught me.
      </>
    ),
    bullets: [
      <>
        More accurate, more insightful matchup and deck stats, tied to the exact deck version you played. KaraBuddy, with
        no decks, never could.
      </>,
      <>A built-in deck builder.</>,
      <>
        Coming soon: collection management. <Tbd>more roadmap items?</Tbd>
      </>,
    ],
  },
  {
    id: 'feedback',
    heading: "Tell me what you'd miss",
    short: (
      <>
        If SWU Forge is missing something you love about KaraBuddy, tell me in the{' '}
        <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> or{' '}
        <Ext href={SWU_FORGE_DISCORD_URL}>SWU Forge Discord</Ext>, and I&apos;ll try to bring it over.
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
