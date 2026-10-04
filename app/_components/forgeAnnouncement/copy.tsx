import type { ReactNode } from 'react';
import Link from 'next/link';
import { tokens } from '@/app/_theme/karabuddyTokens';
import { HUB_PATH, KARABUDDY_DISCORD_URL, SWU_FORGE_DISCORD_URL, SWU_FORGE_DOCS_URL } from './constants';

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: tokens.forge.softText, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
      {children}
    </a>
  );
}

export const headline = 'The future of KaraBuddy';

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
        You don&apos;t have to wait until 2027. If you run a team, you can move it today. Everyone gets an email invitation, and your KaraBuddy team stays as it is.
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
    heading: 'Better replays and stats',
    short: (
      <>
        Replays are the heart of KaraBuddy, and SWU Forge does them better. The first thing I did there was rewrite its
        replay viewer from the ground up, using everything KaraBuddy taught me. SWU Forge also has its own deck builder,
        so every game is tied to the exact deck version you played. That makes its matchup and deck stats more accurate
        and insightful than KaraBuddy&apos;s.
      </>
    ),
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
      <Link href={`/signin?callbackUrl=${HUB_PATH}`} style={{ color: tokens.forge.softText, fontWeight: 600 }}>
        Sign in
      </Link>{' '}
      to see the teams you can move.
    </>
  ),
};

export const actions = {
  primary: 'Open SWU Forge',
  hub: 'Go to the SWU Forge hub',
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

export const hubCopy = {
  intro: 'KaraBuddy keeps running until Legacy of Skywalker releases in 2027. Development continues on SWU Forge.',
  letterButton: 'The future of KaraBuddy',
  move: {
    heading: 'Move your team to SWU Forge',
    status: {
      signedOut: 'Sign in to see the teams you can move.',
      owner: (count: number) => (count === 1 ? 'You own 1 team you can move.' : `You own ${count} teams you can move.`),
      member: "Your team's owner can move it.",
    },
    show: 'Details',
    hide: 'Hide',
    pickLabel: 'Team to move',
    pickPlaceholder: 'Choose a team',
    facts: [
      { ownerOnly: true, text: "You pick each person's role." },
      { ownerOnly: true, text: 'Everyone gets an email invitation and joins when they accept it.' },
      { ownerOnly: true, text: 'You need a SWU Forge account. Sign in there once with the same email or Discord account you use here.' },
      { ownerOnly: false, text: 'Your KaraBuddy team stays as it is.' },
      { ownerOnly: false, text: 'Decks, replays and stats stay on KaraBuddy. Only the team and its people move.' },
    ],
  },
  replays: {
    heading: 'Replays stay on KaraBuddy',
    body: "KaraBuddy replays and stats won't be moved to SWU Forge. The two apps store and keep replays and stats differently, and both lose most of their value as soon as a new set releases, so building a transfer isn't worth the effort or the risk of inaccurate stats. They stay on KaraBuddy until it retires.",
  },
  learn: {
    heading: 'Learn about SWU Forge',
    replays: {
      title: 'Replays',
      body: "SWU Forge's replay viewer was rebuilt from the ground up, using everything learned from building KaraBuddy. Your games and replays live in the Battle Log.",
      link: { label: 'Battle Log guide', href: `${SWU_FORGE_DOCS_URL}/battle-log/battle-log` },
    },
    features: [
      {
        title: 'Matchup and deck stats',
        body: "Stats are tied to the exact deck version you played. KaraBuddy has no deck builder, so it can't do that.",
        link: { label: 'Deck versioning guide', href: `${SWU_FORGE_DOCS_URL}/decks/managing-decks/deck-versioning` },
      },
      {
        title: 'Deck builder',
        body: 'Build and save decks on SWU Forge, and start a new version when you change the list.',
        link: { label: 'Workshop guide', href: `${SWU_FORGE_DOCS_URL}/decks/workshop` },
      },
      {
        title: 'Teams',
        body: 'Share games, stats and decks with your team, and review replays together.',
        link: { label: 'Team Battle Log guide', href: `${SWU_FORGE_DOCS_URL}/teams/team-battle-log` },
      },
    ],
    docs: 'All SWU Forge guides',
  },
  community: {
    heading: 'Community',
    body: 'If SWU Forge is missing something you love about KaraBuddy, say so in either Discord.',
    karabuddyDiscord: 'KaraBuddy Discord',
    forgeDiscord: 'SWU Forge Discord',
  },
};
