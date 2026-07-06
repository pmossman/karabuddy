import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam, generateInvite, claimInstallToken } from './helpers';

// B221: the TWO-PHASE opening gauntlet, end to end — a teammate sets up a
// session on the team's Openings tab (filters + match count + Begin), runs
// the anonymized opening through both karabast prompts on the board layout
// (landscape leader/base center column), gets the reveal (recorded decision +
// identity + distribution + watch link), posts a team-scoped discussion tag
// that auto-@mentions the uploader, finishes on the session summary, and the
// setup screen re-files the item under Answered with its badges. The
// uploader's own view shows the team's verdict.

// A payload with a complete setup: pre-deal frame → dealt hand (6 real cards)
// → resources picked → action. Same shape the recorder uploads (the api-layer
// twin lives in test/api/opening-drills.test.ts).
function drillPayload(gameId: string, opts: { mulligan?: boolean } = {}): string {
  let uu = 0;
  const card = (set: string, num: number) => ({ setId: { set, number: num }, name: `${set} ${num}`, uuid: `u${uu++}` });
  const masked = () => ({ uuid: `m${uu++}` });
  const dealt = [card('SOR', 1), card('SOR', 2), card('SHD', 10), card('SHD', 11), card('TWI', 55), card('JTL', 200)];
  const redrawn = [card('SOR', 90), card('SOR', 91), card('SHD', 92), card('TWI', 93), card('JTL', 94), card('JTL', 95)];
  const kept = opts.mulligan ? redrawn : dealt;
  const resourced = [kept[1], kept[4]];
  const after = kept.filter((c) => c !== resourced[0] && c !== resourced[1]);
  // The FULL pile set — the lifted board indexes deck/discard/arenas
  // unconditionally (real payloads always carry them).
  const allPiles = (piles: { hand?: any[]; resources?: any[] }) => ({
    hand: piles.hand ?? [],
    resources: piles.resources ?? [],
    deck: [],
    discard: [],
    groundArena: [],
    spaceArena: [],
    capturedZone: [],
  });
  const p = (piles: { hand?: any[]; resources?: any[] }) => ({
    user: { username: 'RecKarabast' },
    hasInitiative: true,
    leader: { name: 'Own Leader', setId: { set: 'SOR', number: 5 } },
    base: { name: 'Own Base', setId: { set: 'SOR', number: 20 } },
    cardPiles: allPiles(piles),
  });
  const opp = (hand: any[]) => ({
    user: { username: 'OppKarabast' },
    hasInitiative: false,
    leader: { name: 'Opp Leader', setId: { set: 'TWI', number: 9 } },
    base: { name: 'Opp Base', setId: { set: 'TWI', number: 21 } },
    cardPiles: allPiles({ hand }),
  });
  const frame = (phase: string, mine: { hand?: any[]; resources?: any[] }, oppHand: any[]) => ({
    event: 'gamestate',
    args: [{ full: { id: gameId, phase, players: { p1: p(mine), p2: opp(oppHand) } } }],
  });
  const frames = [
    frame('setup', {}, []),
    frame('setup', { hand: dealt }, Array(6).fill(0).map(masked)),
    ...(opts.mulligan ? [frame('setup', { hand: kept }, Array(6).fill(0).map(masked))] : []),
    frame('setup', { hand: after, resources: resourced }, Array(6).fill(0).map(masked)),
    frame('action', { hand: after, resources: resourced }, Array(4).fill(0).map(masked)),
  ];
  return JSON.stringify({ version: 2, actionCount: 10, durationMs: 1000, localPlayerId: 'p1', events: frames, tags: [] });
}

test('opening gauntlet: setup → play → reveal → tag → summary → uploader view', async ({ page, browser }) => {
  // Owner: team + shared replay with a full setup.
  await signInAsTestUser(page, { name: 'DrillOwner', email: 'drill-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Drill Squad');
  const { code } = await generateInvite(page, teamSlug);
  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  const up = await page.request.post('/api/replays', {
    data: { installToken: ownerToken, payload: drillPayload(`g-${randomUUID()}`), shareTeamSlugs: [teamSlug] },
  });
  expect(up.ok()).toBeTruthy();
  const { slug } = await up.json();

  // Teammate joins.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'DrillMate', email: 'drill-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));

  // SETUP: filters + match count + Begin. No board on this screen. Filter to
  // the deck first — Begin records the set into the per-device filter memory.
  await page2.goto(`/teams/${teamSlug}?tab=openings`);
  await expect(page2.getByTestId('opening-match-count')).toContainText('1 unanswered opening');
  await expect(page2.getByTestId('opening-stage')).toHaveCount(0);
  await page2.getByTestId('opening-filter-deck').click();
  const deckBox = page2.getByPlaceholder('Type to filter…');
  await deckBox.fill('own');
  await deckBox.press('Enter');
  await expect(page2.getByTestId('opening-match-count')).toContainText('1 unanswered opening');
  await page2.getByTestId('opening-begin').click();

  // The session rail (game-log pattern): one mini card per queue item, the
  // current one highlighted; it survives the whole session.
  await expect(page2.getByTestId('opening-session-rail')).toBeVisible();
  await expect(page2.getByTestId('opening-rail-item')).toHaveCount(1);
  await expect(page2.getByTestId('opening-rail-item')).toHaveAttribute('aria-current', 'step');

  // PLAY, stage 1: session HUD + the board column (landscape seats, name
  // plates, Initiative pill on the holder's seat — SWU terms, no play/draw).
  await expect(page2.getByText('Opening 1 of 1')).toBeVisible();
  await expect(page2.getByTestId('opening-mulligan')).toBeVisible();
  await expect(page2.getByTestId('opening-seat-opp')).toBeVisible();
  await expect(page2.getByTestId('opening-seat-own')).toContainText('Your seat');
  const pill = page2.getByText('Initiative', { exact: true });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveCSS('border-top-color', 'rgb(0, 186, 255)'); // --initiative-blue: the recorder's seat
  await expect(page2.getByText(/On the (play|draw)/)).toHaveCount(0);
  await page2.getByTestId('opening-keep').click();

  // Stage 2 — nothing about their call is revealed yet; just pick two.
  await expect(page2.getByText('Select 2 cards to resource')).toBeVisible();
  await expect(page2.getByTestId('opening-beat')).toHaveCount(0);
  await expect(page2.getByTestId('opening-confirm')).toBeDisabled();
  await page2.getByTestId('opening-pick-1').click(); // their actual pick
  await page2.getByTestId('opening-pick-3').click(); // a different second pick
  await page2.getByTestId('opening-confirm').click();

  // The reveal: recorded decision, identity, pick agreement, watch link.
  const reveal = page2.getByTestId('opening-reveal');
  await expect(reveal).toBeVisible();

  // Collapsible on desktop too: minimize → the summary row floats at the
  // board top (verdict at a glance), expand restores the panel.
  await page2.getByTestId('opening-reveal-minimize').click();
  await expect(page2.getByTestId('opening-reveal')).toHaveCount(0);
  await expect(page2.getByTestId('opening-reveal-summary')).toContainText('DrillOwner kept');
  await page2.getByTestId('opening-reveal-expand').click();
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText('DrillOwner kept this hand');
  await expect(reveal).toContainText('so did you');
  await expect(reveal).toContainText('One pick matched.');
  await expect(reveal).toContainText('Team so far — Keep 1 · Mulligan 0');
  // Per-member picks: expand → this responder's resourced + kept cards.
  await expect(page2.getByTestId('opening-member-picks-toggle')).toContainText('Team picks · 1');
  await page2.getByTestId('opening-member-picks-toggle').click();
  await expect(page2.getByTestId('opening-member-picks')).toContainText('Resourced');
  await expect(page2.getByTestId('opening-member-picks')).toContainText('In hand');
  await expect(page2.getByTestId('opening-member-picks')).toContainText('DrillMate');
  // The recorder's actual selection anchors the comparison at the top.
  await expect(page2.getByTestId('opening-member-recorder')).toContainText('DrillOwner');
  await expect(page2.getByTestId('opening-member-recorder')).toContainText('recorded keep');
  // The whole-hand preview triggers on a CARD, not the row chrome. Hovering
  // the member's NAME does nothing…
  await page2.getByTestId('opening-member-recorder').getByText('recorded keep').hover();
  await expect(page2.getByTestId('opening-hand-preview')).toHaveCount(0);
  // …hovering a card floats their WHOLE hand large (6 cards).
  await page2.getByTestId('opening-member-recorder').locator('img[alt]').first().hover();
  await expect(page2.getByTestId('opening-hand-preview')).toBeVisible();
  await expect(page2.getByTestId('opening-hand-preview')).toContainText('DrillOwner');
  await expect(page2.getByTestId('opening-hand-preview').locator('img[alt]')).toHaveCount(6);
  await page2.getByTestId('opening-member-picks-toggle').click(); // collapse again

  // The resource diff is painted on the hand, each card self-labeled:
  // green shared pick, yellow theirs-only, cyan yours-only. No legend.
  await expect(page2.getByText('Both picked', { exact: true })).toBeVisible();
  await expect(page2.getByText('Their pick', { exact: true })).toBeVisible();
  await expect(page2.getByText('Your pick', { exact: true })).toBeVisible();
  await expect(page2.getByTestId('opening-legend')).toHaveCount(0);

  // "Watch from the opening" opens the mini-player MODAL (no navigation):
  // just the board + step controls, arrow keys included.
  await page2.getByTestId('opening-watch').click();
  await expect(page2.getByTestId('gameboard-board-wrapper')).toBeVisible();
  // Pop-out goes to the FULL viewer at the current frame, new tab.
  await expect(page2.getByTestId('opening-watch-popout')).toHaveAttribute('href', new RegExp(`/r/${slug}\\?f=\\d+`));
  await expect(page2.getByTestId('opening-watch-popout')).toHaveAttribute('target', '_blank');
  const pos0 = await page2.getByTestId('opening-watch-pos').textContent();
  await page2.keyboard.press('ArrowRight');
  await expect(page2.getByTestId('opening-watch-pos')).not.toHaveText(pos0!);
  await page2.getByTestId('opening-watch-next').click();
  await page2.keyboard.press('Escape');
  await expect(page2.getByTestId('gameboard-board-wrapper')).toHaveCount(0);
  // Still on the reveal — the modal never navigated.
  await expect(page2.getByTestId('opening-reveal')).toBeVisible();
  // Post-reveal the seat plate names the recorder.
  await expect(page2.getByTestId('opening-seat-own')).toContainText('DrillOwner');

  // Post the disagreement — a team-scoped tag on the source replay. No
  // auto-mention (default = no notification); the canonical @-autocomplete
  // (MentionInput) picks the uploader, riding the normal mention machinery.
  await page2.getByTestId('opening-comment').fill('I resource the Cantwell here every time, @Drill');
  await page2.getByTestId('opening-comment').press('Enter'); // popover open → confirms the DrillOwner suggestion
  await page2.getByTestId('opening-post').click();
  await expect(page2.getByTestId('opening-posted-note')).toContainText('Posted.');
  // The comment lands in the reveal's own discussion list — still there when
  // the opening is reopened later.
  await expect(page2.getByTestId('opening-comments')).toContainText('I resource the Cantwell here every time');
  await expect(page2.getByTestId('opening-comments')).toContainText('DrillMate');

  // Redo as a PRACTICE run — replay the motions with a different answer.
  // The throwaway answer drives the diff, but the STORED answer and the team
  // distribution stay untouched (first answer counts).
  await page2.getByTestId('opening-retry').click();
  await page2.getByTestId('opening-mulligan').click();
  // You mulliganed but they kept: the ONLY early reveal (the unchanged hand
  // would otherwise read as a bug).
  await expect(page2.getByTestId('opening-beat')).toContainText('They kept this hand');
  await page2.getByTestId('opening-pick-0').click();
  await page2.getByTestId('opening-pick-2').click();
  await page2.getByTestId('opening-confirm').click();
  await expect(page2.getByTestId('opening-practice-note')).toContainText('recorded answer (keep) unchanged');
  await expect(page2.getByTestId('opening-reveal')).toContainText('you said mulligan');
  await expect(page2.getByTestId('opening-reveal')).toContainText('Team so far — Keep 1 · Mulligan 0');

  // Finish → session summary → back to setup, where the item is re-filed
  // under Answered with its badges.
  await page2.getByTestId('opening-next').click(); // "Finish session" (last item)
  await expect(page2.getByTestId('opening-summary')).toContainText('Session complete');
  await expect(page2.getByTestId('opening-summary')).toContainText('1 opening · 1 matched');
  await page2.getByTestId('opening-new-session').click();
  await expect(page2.getByTestId('opening-match-count')).toContainText('0 unanswered openings');
  const row = page2.getByTestId('opening-row');
  await expect(row).toHaveCount(1);
  // Same decision (keep) but only ONE pick matched → NOT full consensus.
  await expect(row).toContainText('Picks differ');
  await expect(row).toContainText('💬 1');

  // "Show all" opens the HISTORY view — filters carry over (same state), the
  // graded item lists with its outcome glyph, and Back returns to setup.
  await page2.getByTestId('opening-answered-showall').click();
  await expect(page2.getByTestId('opening-history')).toBeVisible();
  await expect(page2.getByTestId('opening-history')).toContainText('Answered openings · 1');
  await expect(page2.getByTestId('opening-row')).toHaveCount(1);
  await page2.getByTestId('opening-history-back').click();
  await expect(page2.getByTestId('opening-begin')).toBeVisible();

  // Filter memory: the set used at Begin is restorable with one click after
  // a Reset — on this view and the history view alike.
  await page2.getByTestId('opening-filter-reset').click();
  await expect(page2.getByTestId('opening-filter-deck')).toContainText('Any leader');
  await page2.getByTestId('filter-memory-recent').click(); // the compact Recent menu
  await expect(page2.getByTestId('filter-memory-chip')).toContainText('Own Leader');
  await page2.getByTestId('filter-memory-chip').click();
  await expect(page2.getByTestId('opening-filter-deck')).toContainText('Own Leader');

  // The tag really landed: team-scoped, anchored at the decision frame, and
  // the TYPED @DrillOwner resolved to a real mention (no silent auto-mention).
  const tagsRes = await page.request.get(`/api/replays/${slug}/tags`);
  const tags = (await tagsRes.json()).data as any[];
  const posted = tags.find((t) => t.comment.includes('Cantwell'));
  expect(posted).toBeTruthy();
  expect(posted.frameIndex).toBe(1); // anchored at the dealt-hand (decision) frame
  expect(posted.mentions?.userIds ?? posted.mentions ?? []).toHaveLength(1); // the typed mention resolved

  // The uploader's feedback finder: the with-comments filter on My openings.

  // Uploader view: their own opening on the setup screen with the team's
  // verdict; clicking it opens the reveal (no answering their own).
  await page.goto(`/teams/${teamSlug}?tab=openings`);
  await expect(page.getByText('With comments (1)')).toBeVisible();
  const ownRow = page.getByTestId('opening-row');
  await expect(ownRow).toHaveCount(1);
  await expect(ownRow).toContainText('DrillOwner (you)');
  await expect(ownRow).toContainText('Picks differ');
  await expect(ownRow).toContainText('💬 1');
  await ownRow.click();
  // A revisit is NOT a session: no session copy, a Done button, no rail.
  await expect(page.getByText('Reviewing opening')).toBeVisible();
  await expect(page.getByTestId('opening-session-rail')).toHaveCount(0);
  await expect(page.getByTestId('opening-reveal')).toContainText('DrillMate');
  await expect(page.getByTestId('opening-reveal')).toContainText('Team so far — Keep 1 · Mulligan 0');
  await expect(page.getByTestId('opening-next')).toContainText('Done');
  // The owner sees the feedback right on the reveal too.
  await expect(page.getByTestId('opening-comments')).toContainText('I resource the Cantwell here every time');
});

test('mobile: the two-phase flow works at 390px, footer reclaimed', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'MobOwner', email: 'mob-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Mobile Squad');
  const { code } = await generateInvite(page, teamSlug);
  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  await page.request.post('/api/replays', {
    data: { installToken: ownerToken, payload: drillPayload(`g-${randomUUID()}`), shareTeamSlugs: [teamSlug] },
  });

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'MobMate', email: 'mob-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));
  await page2.goto(`/teams/${teamSlug}?tab=openings`);

  // The gauntlet reclaims the sticky footer's band.
  await expect(page2.locator('footer')).toBeHidden();

  // Setup → play: the whole flow works at phone width (the hand self-scales;
  // no horizontal overflow blocking the picks).
  await page2.getByTestId('opening-begin').click();
  await expect(page2.getByTestId('opening-keep')).toBeVisible();

  // On mobile the session rail is a slide-over drawer behind the HUD toggle.
  await expect(page2.getByTestId('opening-session-rail')).toHaveCount(0);
  await page2.getByTestId('opening-rail-toggle').click();
  await expect(page2.getByTestId('opening-session-rail')).toBeVisible();
  await page2.getByLabel('Close session list').click();
  await expect(page2.getByTestId('opening-session-rail')).toHaveCount(0);
  await page2.getByTestId('opening-keep').click();
  await page2.getByTestId('opening-pick-0').click();
  await page2.getByTestId('opening-pick-5').click();
  await page2.getByTestId('opening-confirm').click();
  await expect(page2.getByTestId('opening-reveal')).toBeVisible();

  // Mobile reveal = a TRUE modal over everything (the in-board float left the
  // hands off-screen). Minimize → the whole board is visible again; the
  // floating pill restores the panel.
  await expect(page2.getByTestId('opening-reveal-overlay')).toBeVisible();
  await page2.getByTestId('opening-reveal-minimize').click();
  await expect(page2.getByTestId('opening-reveal-overlay')).toHaveCount(0);
  // Minimized = a slim summary row (the verdict at a glance) + expand.
  await expect(page2.getByTestId('opening-reveal-summary')).toContainText('MobOwner kept');
  await expect(page2.getByTestId('opening-stage')).toBeVisible();
  await page2.getByTestId('opening-reveal-expand').click();
  await expect(page2.getByTestId('opening-reveal-overlay')).toBeVisible();
  await expect(page2.getByTestId('opening-reveal-summary')).toHaveCount(0);
  await page2.getByTestId('opening-next').click();
  await expect(page2.getByTestId('opening-summary')).toBeVisible();

  // No horizontal page overflow at 390px (the classic hand failure mode).
  const overflow = await page2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('consensus: matching the decision AND both picks earns the green badge', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'ConOwner', email: 'con-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Consensus Squad');
  const { code } = await generateInvite(page, teamSlug);
  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  await page.request.post('/api/replays', {
    data: { installToken: ownerToken, payload: drillPayload(`g-${randomUUID()}`), shareTeamSlugs: [teamSlug] },
  });

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'ConMate', email: 'con-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));
  await page2.goto(`/teams/${teamSlug}?tab=openings`);
  await page2.getByTestId('opening-begin').click();
  await page2.getByTestId('opening-keep').click(); // recorder kept
  // Pick BOTH of the recorder's resources (indices 1 and 4) → full match.
  await page2.getByTestId('opening-pick-1').click();
  await page2.getByTestId('opening-pick-4').click();
  await page2.getByTestId('opening-confirm').click();
  await expect(page2.getByTestId('opening-reveal')).toContainText('Same two picks.');
  await page2.getByTestId('opening-next').click(); // Finish session
  await page2.getByTestId('opening-new-session').click();
  const row = page2.getByTestId('opening-row');
  await expect(row).toContainText('Consensus');
  await expect(row).not.toContainText('Picks differ');
});


test('the fork: they mulliganed, you kept — both timelines render', async ({ page, browser }) => {
  await signInAsTestUser(page, { name: 'ForkOwner', email: 'fork-owner@example.com' });
  const { slug: teamSlug } = await createTeam(page, 'Fork Squad');
  const { code } = await generateInvite(page, teamSlug);
  const ownerToken = `kbx_${randomUUID()}`;
  await claimInstallToken(page, ownerToken);
  await page.request.post('/api/replays', {
    data: { installToken: ownerToken, payload: drillPayload(`g-${randomUUID()}`, { mulligan: true }), shareTeamSlugs: [teamSlug] },
  });

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await signInAsTestUser(page2, { name: 'ForkMate', email: 'fork-mate@example.com' });
  await page2.goto(`/teams/join?code=${code}`);
  await page2.waitForURL(new RegExp(`/teams/${teamSlug}`));
  await page2.goto(`/teams/${teamSlug}?tab=openings`);
  await page2.getByTestId('opening-begin').click();

  // Disagree with their mulligan: say KEEP. Stage 2 stays in YOUR world —
  // the DEALT hand, no beat, no redraw caption — so your kept-hand resource
  // picks are captured as discussion data before anything is revealed.
  await page2.getByTestId('opening-keep').click();
  await expect(page2.getByText('Select 2 cards to resource')).toBeVisible();
  await expect(page2.getByTestId('opening-beat')).toHaveCount(0);
  await expect(page2.getByText('Their redraw')).toHaveCount(0);
  await expect(page2.getByTestId('opening-kept-world')).toHaveCount(0);
  await page2.getByTestId('opening-pick-0').click();
  await page2.getByTestId('opening-pick-2').click();
  await page2.getByTestId('opening-confirm').click();

  // Reveal: the fork. Their redraw on top with THEIR picks (yellow), your
  // kept world below with YOUR picks (cyan) — different hands, so no
  // matched-picks claim.
  await expect(page2.getByTestId('opening-reveal')).toContainText('ForkOwner mulliganed');
  await expect(page2.getByTestId('opening-reveal')).toContainText('you said keep');
  await expect(page2.getByTestId('opening-reveal')).toContainText('Your picks are on your kept hand below');
  await expect(page2.getByText('Their redraw')).toBeVisible();
  await expect(page2.getByText('Their pick', { exact: true })).toHaveCount(2);
  const keptWorld = page2.getByTestId('opening-kept-world');
  await expect(keptWorld).toContainText('Your kept hand');
  await expect(keptWorld.getByText('Your pick', { exact: true })).toHaveCount(2);

  // Per-member picks show BOTH resourced cards even in the fork (keep answer
  // vs recorded mulligan) — the source-hand resolution finds the right hand.
  await page2.getByTestId('opening-member-picks-toggle').click();
  await expect(page2.getByTestId('opening-member-resourced').locator('button[aria-label]')).toHaveCount(2);
});
