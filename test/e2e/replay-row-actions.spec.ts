import { test, expect } from '@playwright/test';
import { signInAsTestUser, createTeam, uploadReplay } from './helpers';

// Core: manage a replay straight from the browser — without opening the
// viewer. Clicking the 💬 count reads the comments inline; the row kebab
// exposes inline team-share toggles + the decks view.
test('Row kebab menu: clickable comment count, inline team-share toggle, and decks from the browser', async ({ page }) => {
  await signInAsTestUser(page, { name: 'MgrOwner', email: 'mgr@example.com' });
  const { slug: team } = await createTeam(page, 'Mgr Team');

  const localId = 'mgr-local-' + Math.random().toString(36).slice(2, 8);
  // Uploaded via page.request → attributed to the signed-in account, so it
  // shows in "Your replays".
  const r = await uploadReplay(page.request, {
    local: { id: localId, username: 'MgrOwner' },
    opponent: { username: 'MgrOpp' },
    decks: {
      [localId]: {
        username: 'MgrOwner',
        name: 'Tournament List',
        leader: { id: 'ASH_005', count: 1 },
        base: { id: 'JTL_024', count: 1 },
        deck: [{ id: 'ASH_010', count: 3 }],
        sideboard: null,
      },
    },
  });

  // Two comments on the replay.
  for (const c of ['first note', 'second note']) {
    const res = await page.request.post(`/api/replays/${r.slug}/tags`, {
      data: { installToken: r.installToken, authorName: 'MgrOwner', frameIndex: 0, comment: c },
    });
    expect(res.ok(), `tag failed: ${res.status()}`).toBe(true);
  }

  await page.goto('/replays');

  // The 💬 count is visible, and clicking it reads the discussion inline —
  // no viewer.
  const commentBtn = page.getByTestId(`replay-comment-count-${r.slug}`);
  await expect(commentBtn).toContainText('2');
  await commentBtn.click();
  const comments = page.getByTestId('comments-modal');
  await expect(comments).toBeVisible();
  await expect(comments.getByText('first note')).toBeVisible();
  await expect(comments.getByText('second note')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(comments).toHaveCount(0);

  // Open the row's kebab (⋮) menu of common actions.
  await page.getByTestId(`row-actions-${r.slug}`).click();
  const menu = page.getByTestId(`row-menu-${r.slug}`);
  await expect(menu).toBeVisible();

  // Lightweight share toggle lives right in the menu — no heavy overlay.
  const toggle = menu.getByRole('checkbox', { name: 'Mgr Team' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // "View decks" opens a decks-only modal linking to the dedicated deck page.
  await menu.getByRole('menuitem', { name: /View decks/i }).click();
  const decks = page.getByTestId('decks-modal');
  await expect(
    decks.getByRole('link', { name: /View full page/i }).first(),
  ).toHaveAttribute('href', `/r/${r.slug}/deck/${localId}`);
  await page.keyboard.press('Escape');

  // The share persisted: reload recomputes the SSR tab counts → Shared = 1.
  await page.reload();
  await expect(page.getByTestId('replays-tab-shared')).toContainText('1');
});
