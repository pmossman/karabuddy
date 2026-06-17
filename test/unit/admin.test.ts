import { describe, it, expect, afterEach } from 'vitest';
import { isAdmin, isAdminEmail, adminEmails } from '@/lib/admin';

const ENV = process.env.KARABUDDY_ADMIN_EMAILS;
afterEach(() => { process.env.KARABUDDY_ADMIN_EMAILS = ENV; });

describe('admin gating', () => {
  it('nobody is admin when the env is unset/empty', () => {
    delete process.env.KARABUDDY_ADMIN_EMAILS;
    expect(adminEmails()).toEqual([]);
    expect(isAdmin({ user: { email: 'parkermos@gmail.com' } })).toBe(false);
  });
  it('allowlists the configured emails (case/space-insensitive)', () => {
    process.env.KARABUDDY_ADMIN_EMAILS = ' Parkermos@gmail.com , other@x.com ';
    expect(isAdminEmail('parkermos@gmail.com')).toBe(true);
    expect(isAdmin({ user: { email: 'PARKERMOS@gmail.com' } })).toBe(true);
    expect(isAdmin({ user: { email: 'other@x.com' } })).toBe(true);
    expect(isAdmin({ user: { email: 'stranger@x.com' } })).toBe(false);
  });
  it('is false for signed-out / missing email', () => {
    process.env.KARABUDDY_ADMIN_EMAILS = 'parkermos@gmail.com';
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin({ user: null })).toBe(false);
    expect(isAdmin({ user: { email: null } })).toBe(false);
  });
});
