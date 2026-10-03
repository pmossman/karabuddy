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
    As some of you know, I joined SWU Forge a few months ago, and that&apos;s where most of my development time has gone
    since. KaraBuddy will keep running through the Homeworlds and Icons sets. When Legacy of Skywalker releases in 2027,
    I&apos;ll retire it and put my full effort into making SWU Forge as good as it can possibly be.
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
    id: 'move',
    heading: 'Bring your team over',
    short: (
      <>
        You pick everyone&apos;s role, each teammate gets an email invitation, and your KaraBuddy team stays as it is.
        You&apos;ll need an SWU Forge account with the same email.
      </>
    ),
  },
  {
    id: 'why',
    heading: "Why I'm doing this",
    short: (
      <>
        I built KaraBuddy fast, on shaky technical ground, to get something useful out to the community. Karabast&apos;s
        changes keep breaking its extension-based recording and its modified copy of an old Karabast client. SWU Forge is
        built from scratch on a foundation that can keep up, and a direct Karabast account link is on the way, so you
        won&apos;t need an extension at all.
      </>
    ),
  },
  {
    id: 'hosting',
    heading: 'Until then',
    short: <>KaraBuddy stays as it is, and I&apos;ll fix what breaks.</>,
  },
  {
    id: 'forge',
    heading: "What's on SWU Forge",
    bullets: [
      <>A built-in deck builder, with versions and public decks.</>,
      <>Battle Log and replays, linked to the deck you played.</>,
      <>Teams with shared decks, matchup tables and replay reviews.</>,
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
        If there&apos;s something on KaraBuddy you&apos;d miss, tell me in the{' '}
        <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> or the{' '}
        <Ext href={SWU_FORGE_DISCORD_URL}>SWU Forge Discord</Ext>, and I&apos;ll try to bring it over before KaraBuddy retires.
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
