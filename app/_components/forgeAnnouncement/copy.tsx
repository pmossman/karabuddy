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

export const headline = "I'm moving my development to SWU Forge";

export const lede: ReactNode = (
  <>
    From now on, most of my development time goes into SWU Forge, with the goal of bringing the KaraBuddy experience
    there. I know a lot of you like KaraBuddy, and some of you prefer it, so here is what that means for KaraBuddy and
    why I&apos;m doing it.
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
    heading: 'What happens to KaraBuddy',
    short: <>KaraBuddy keeps running for now, and I&apos;ll fix things as needed.</>,
    more: (
      <>
        If something stops working, tell me in the <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext>.
      </>
    ),
  },
  {
    id: 'hosting',
    heading: 'Free hosting, and a limit on old replays',
    short: (
      <>
        I&apos;m moving KaraBuddy to free-tier hosting so it costs nothing to keep running. The free database is small, so
        replays older than 60 days will be deleted, along with the stats that come from them. Public and clipped replays
        are kept. <Tbd>when this starts; MIGRATION.md allows dropping 60 to 45 days if the free database runs short</Tbd>
      </>
    ),
    more: (
      <>
        A replay that is more than 30 days old and has never been opened also loses its board playback. Its result and
        decks stay until the 60-day limit. Public and clipped replays, and replays marked as reviewed, keep their
        playback. If there&apos;s a replay you want to keep past 60 days, make it public or clip it.
      </>
    ),
  },
  {
    id: 'why',
    heading: 'Why',
    short: (
      <>
        KaraBuddy records games through a browser extension, and its replay viewer is built on a modified copy of the game
        board from an old Karabast client build. Both are likely to break as Karabast changes its platform. This week, Karabast&apos;s second-leader
        change broke leaders in KaraBuddy replays. SWU Forge&apos;s replay viewer was built from scratch as its own client,
        so I can adapt it much more easily.
      </>
    ),
  },
  {
    id: 'forge',
    heading: 'What SWU Forge has',
    bullets: [
      <>A deck builder with card search, deck versions and public decks.</>,
      <>Battle Log, which records your Karabast games, links each one to the deck you played, and plays it back in SWU Forge&apos;s own replay viewer.</>,
      <>Teams with shared deck folders, a team battle log, matchup tables and replay reviews.</>,
    ],
    more: (
      <>
        Every match has its own link, and you choose whether only you, your teams or anyone can open it. Review requests
        can notify you on Discord. Recording on SWU Forge uses its own Chrome extension, the SWU Forge Kara Tracker.
      </>
    ),
  },
  {
    id: 'move',
    heading: 'Move your team to SWU Forge',
    more: (
      <>
        You need an SWU Forge account that uses the same email as your KaraBuddy account; the move page tells you if you
        don&apos;t have one. Before anything is sent, you see your whole team and pick each member&apos;s role. Nobody joins
        until they accept the invitation, and members without an email on KaraBuddy can&apos;t be moved. Decks, replays, stats and
        your team&apos;s Discord bot setup stay on KaraBuddy. Only the team and its members move.
      </>
    ),
  },
  {
    id: 'roadmap',
    heading: "What's next on SWU Forge",
    bullets: [
      <>Collection management, for tracking which cards and printings you own.</>,
      <>
        Importing KaraBuddy replays into SWU Forge.{' '}
        <Tbd>keep? Planned in Forge&apos;s docs/first-class-replays-plan.md, not built</Tbd>
      </>,
      <Tbd>more roadmap items?</Tbd>,
    ],
  },
  {
    id: 'feedback',
    heading: 'Tell me what to bring over',
    short: (
      <>
        What do you use on KaraBuddy that you want on SWU Forge? Tell me in the{' '}
        <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> or the{' '}
        <Ext href={SWU_FORGE_DISCORD_URL}>SWU Forge Discord</Ext>.
      </>
    ),
  },
];

export const moveCopy = {
  ownerIntro: (count: number) =>
    count === 1
      ? 'You own this team. Moving it creates it on SWU Forge with you as the owner and emails your teammates an invitation. Your KaraBuddy team stays as it is.'
      : 'You own these teams. Moving one creates it on SWU Forge with you as the owner and emails your teammates an invitation. Your KaraBuddy team stays as it is.',
  ownerLink: 'Move to SWU Forge',
  memberOnly: "Your team's owner can move the team to SWU Forge. When they do, you'll get an email invitation.",
  memberToo: "For teams you don't own, the owner can move them. You'll get an email invitation when they do.",
  signedOut: (
    <>
      If you own a team,{' '}
      <Link href={`/signin?callbackUrl=${FULL_NOTE_PATH}`} style={{ color: tokens.forge.softText, fontWeight: 600 }}>
        sign in
      </Link>{' '}
      and this page will list your teams with a link to move each one.
    </>
  ),
};

export const actions = {
  primary: 'Open SWU Forge',
  fullNote: 'Read the full note',
  close: 'Close',
};

export const signOff = 'Parker';
