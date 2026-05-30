import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signInAsTestUser, createTeam } from './helpers';
import { frozenUploadBody, frozenClaimBody, frozenTeamShareBody } from './fixtures/contract-0.5.0';

// B72: extension↔server CONTRACT tests. These replay the exact request
// shapes the shipped 0.5.0 extension sends and assert the CURRENT server
// still accepts them — the version-skew guarantee (live server must serve
// every extension version in the wild during CWS review). If the server
// stops accepting a 0.5.0 shape, this fails BEFORE the change ships.

test.describe('extension 0.5.0 wire contract', () => {
  test('upload (no shareTeamSlugs) is accepted and lifts the embedded tag (no teamSlugs)', async ({ page, request }) => {
    const installToken = `kbx_${randomUUID()}`;
    const gameId = randomUUID();

    // 0.5.0's SW uploads anonymously — body is exactly { installToken, payload }.
    const res = await request.post('/api/replays', { data: frozenUploadBody(installToken, gameId) });
    expect(res.ok(), `upload rejected: ${res.status()} ${await res.text()}`).toBe(true);
    const { slug } = await res.json();
    expect(slug).toBeTruthy();

    // The embedded tag (0.5.0 shape, no teamSlugs) is lifted; its author sees it.
    await signInAsTestUser(page, { name: 'ContractUploader', email: 'contract-up@example.com' });
    await page.request.post('/api/me/claim', { data: frozenClaimBody(installToken) });
    const tagsRes = await page.request.get(`/api/replays/${slug}/tags`, { headers: { 'X-Install-Token': installToken } });
    expect(tagsRes.ok()).toBe(true);
    expect(((await tagsRes.json()).data as any[]).map((t) => t.comment)).toContain('frozen 0.5.0 tag');
  });

  test('claim / team-shares / whoami / teams-mention-data accept 0.5.0 shapes', async ({ page, request }) => {
    await signInAsTestUser(page, { name: 'ContractOwner', email: 'contract-owner@example.com' });
    const { slug: teamSlug } = await createTeam(page, 'Contract Team');

    const installToken = `kbx_${randomUUID()}`;
    const upload = await request.post('/api/replays', { data: frozenUploadBody(installToken, randomUUID()) });
    expect(upload.ok(), `upload rejected: ${upload.status()} ${await upload.text()}`).toBe(true);
    const { slug } = await upload.json();
    expect(slug, 'no slug from upload').toBeTruthy();

    // claim: 0.5.0 bridge runs on the karabuddy origin (session cookie).
    const claim = await page.request.post('/api/me/claim', { data: frozenClaimBody(installToken) });
    expect(claim.ok(), 'claim rejected').toBe(true);

    // team-shares: { teamSlug } body + X-Install-Token header (0.5.0 sends both).
    const share = await page.request.post(`/api/replays/${slug}/team-shares`, {
      data: frozenTeamShareBody(teamSlug),
      headers: { 'X-Install-Token': installToken },
    });
    expect(share.ok(), `team-shares rejected: ${share.status()} ${await share.text()}`).toBe(true);

    // whoami / teams-mention-data: 0.5.0 SW relies on X-Install-Token (no
    // reliable cross-origin cookie), so hit them via the anonymous context.
    const whoami = await request.get('/api/me/whoami', { headers: { 'X-Install-Token': installToken } });
    expect(whoami.ok()).toBe(true);
    expect((await whoami.json()).ok).toBe(true);

    const mention = await request.get('/api/me/teams-mention-data', { headers: { 'X-Install-Token': installToken } });
    expect(mention.ok()).toBe(true);
    expect((await mention.json()).ok).toBe(true);
  });
});
