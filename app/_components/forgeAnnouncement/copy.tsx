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
    I wanted to tell you myself where my time is going. I&apos;ve moved most of my development over to SWU Forge, and my
    goal is to bring the KaraBuddy experience there with it. I know a lot of you have made KaraBuddy part of how you
    prep, and some of you prefer it to anything else out there. That means a lot to me, so I want to be upfront about
    what this means for KaraBuddy and why I&apos;m doing it.
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
    heading: 'What this means for KaraBuddy',
    short: (
      <>
        KaraBuddy isn&apos;t going anywhere for now. I&apos;ll keep it running and fix things when they break. The difference
        is that new features will mostly land on SWU Forge.
      </>
    ),
    more: (
      <>
        If something stops working, let me know in the <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> and
        I&apos;ll take a look.
      </>
    ),
  },
  {
    id: 'hosting',
    heading: 'Keeping it running for free',
    short: (
      <>
        So that KaraBuddy can keep going for the long haul, I&apos;m moving it to free-tier hosting where it costs nothing
        to run. The catch is that the free database is small, so replays older than 60 days will be deleted, along with the
        stats that come from them. Public and clipped replays are kept.{' '}
        <Tbd>when this starts; MIGRATION.md allows dropping 60 to 45 days if the free database runs short</Tbd>
      </>
    ),
    more: (
      <>
        Replays more than 30 days old that nobody has opened will also lose their board playback, though their result and
        decks stay until the 60-day mark. Public, clipped and reviewed replays keep their playback. If there&apos;s a game
        you want to hang on to, make it public or clip it.
      </>
    ),
  },
  {
    id: 'why',
    heading: "Why I'm doing this",
    short: (
      <>
        Honestly, KaraBuddy is fragile in ways I can&apos;t fix. It records games with a browser extension that reads
        Karabast&apos;s page, and its replay viewer is built on a modified copy of the game board from an old Karabast
        client. Whenever Karabast changes something, either one can break. It happened again this week, when
        Karabast&apos;s second-leader change wiped the leaders from KaraBuddy replays. On SWU Forge I built the replay viewer
        from scratch as its own client, so keeping up with Karabast is much easier. SWU Forge still records through a
        browser extension today, but we&apos;re working on an integration that links your Karabast account directly to
        your SWU Forge account, so you won&apos;t need an extension at all.
      </>
    ),
  },
  {
    id: 'forge',
    heading: "What you'll find on SWU Forge",
    bullets: [
      <>A deck builder built right in, with card search, deck versions and public decks.</>,
      <>Battle Log, which records your Karabast games, links each one to the deck you played, and plays it back in SWU Forge&apos;s own replay viewer.</>,
      <>Teams with shared deck folders, a team battle log, matchup tables and replay reviews.</>,
    ],
    more: (
      <>
        Every match gets its own link, and you decide whether only you, your teams or anyone can open it. Review requests
        can ping you on Discord.
      </>
    ),
  },
  {
    id: 'move',
    heading: 'Bringing your team with you',
    more: (
      <>
        You&apos;ll need an SWU Forge account with the same email as your KaraBuddy account, and the move page will tell
        you if you don&apos;t have one yet. Before anything is sent, you&apos;ll see your whole team and pick each
        person&apos;s role. Nobody is added until they accept their invitation, and anyone without an email on KaraBuddy
        can&apos;t be moved. Decks, replays, stats and your Discord bot setup stay on KaraBuddy. Only the team and its
        people come across.
      </>
    ),
  },
  {
    id: 'roadmap',
    heading: "What's coming to SWU Forge",
    bullets: [
      <>Collection management, so you can keep track of which cards and printings you own.</>,
      <>
        Importing KaraBuddy replays into SWU Forge.{' '}
        <Tbd>keep? Planned in Forge&apos;s docs/first-class-replays-plan.md, not built</Tbd>
      </>,
      <Tbd>more roadmap items?</Tbd>,
    ],
  },
  {
    id: 'feedback',
    heading: "Tell me what you'd miss",
    short: (
      <>
        If there&apos;s something you love about KaraBuddy that SWU Forge doesn&apos;t have yet, I really want to hear
        about it. Tell me in the <Ext href={KARABUDDY_DISCORD_URL}>KaraBuddy Discord</Ext> or the{' '}
        <Ext href={SWU_FORGE_DISCORD_URL}>SWU Forge Discord</Ext>, and I&apos;ll do my best to bring it over.
      </>
    ),
  },
];

export const moveCopy = {
  ownerIntro: (count: number) =>
    count === 1
      ? "You own this team, so you can bring it over whenever you're ready. Moving it creates the team on SWU Forge with you as the owner and emails everyone an invitation. Your KaraBuddy team stays exactly as it is."
      : "You own these teams, so you can bring any of them over whenever you're ready. Moving one creates it on SWU Forge with you as the owner and emails everyone an invitation. Your KaraBuddy team stays exactly as it is.",
  ownerLink: 'Move to SWU Forge',
  memberOnly: "Your team's owner can move the team to SWU Forge. When they do, you'll get an email invitation to join.",
  memberToo: "For teams you don't own, the owner can move them, and you'll get an email invitation when they do.",
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

export const signOff: ReactNode = (
  <>
    Thank you for everything you&apos;ve put into KaraBuddy. I hope to see you on SWU Forge.
    <br />
    <br />
    Parker
  </>
);
