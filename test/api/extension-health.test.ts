import { describe, it, expect, vi, afterEach } from 'vitest';
import { POST as health } from '@/app/api/extension/health/route';

// B80: the drift-beacon endpoint's job is the privacy guarantee — it records
// ONLY codes from the fixed knownIssueCodes() enum, dropping anything else, so
// no arbitrary content (game data, PII, injected strings) can ever be stored.

const post = (body: unknown) => health(new Request('http://test/api/extension/health', { method: 'POST', body: JSON.stringify(body) }));

afterEach(() => vi.restoreAllMocks());

describe('POST /api/extension/health', () => {
  it('records recognized codes (and logs only those + version)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ version: '0.5.3', issues: ['missing_players', 'leader_no_setid'] });
    expect((await res.json())).toMatchObject({ ok: true, recorded: true });
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).toContain('missing_players');
    expect(logged).toContain('0.5.3');
  });

  it('DROPS any code not in the enum — nothing arbitrary can be recorded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({
      version: 'x',
      issues: ['missing_gameid', 'username:Alice', '<script>alert(1)</script>', { id: 'SOR_010' }, 'no_active_flag'],
    });
    const body = await res.json();
    expect(body.recorded).toBe(true);
    const logged = warn.mock.calls[0][0] as string;
    // Only the two valid enum codes survive; the injected/PII-ish entries are gone.
    expect(logged).toContain('missing_gameid');
    expect(logged).toContain('no_active_flag');
    expect(logged).not.toContain('Alice');
    expect(logged).not.toContain('<script>');
    expect(logged).not.toContain('SOR_010');
  });

  it('does not log when no recognized codes are present (no noise / no leak)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ version: 'x', issues: ['totally_made_up', 'another'] });
    expect((await res.json()).recorded).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('tolerates a malformed body', async () => {
    const res = await health(new Request('http://test', { method: 'POST', body: 'not json' }));
    expect((await res.json()).ok).toBe(true);
  });
});
