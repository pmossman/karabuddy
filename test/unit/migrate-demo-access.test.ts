import { describe, it, expect, afterEach } from 'vitest';
import { canSeeMigrateDemo, migrateDemoEmails } from '@/lib/migrateDemoAccess';

const ENV = process.env.KARABUDDY_MIGRATE_DEMO_EMAILS;
afterEach(() => { process.env.KARABUDDY_MIGRATE_DEMO_EMAILS = ENV; });

describe('migrate-demo access gate', () => {
  it('nobody sees it when the env is unset/empty (safe default)', () => {
    delete process.env.KARABUDDY_MIGRATE_DEMO_EMAILS;
    expect(migrateDemoEmails()).toEqual([]);
    expect(canSeeMigrateDemo({ user: { email: 'owner@example.com' } })).toBe(false);
  });
  it('allowlists the configured emails (case/space-insensitive)', () => {
    process.env.KARABUDDY_MIGRATE_DEMO_EMAILS = ' Owner@example.com , Guest@example.com ';
    expect(canSeeMigrateDemo({ user: { email: 'owner@example.com' } })).toBe(true);
    expect(canSeeMigrateDemo({ user: { email: 'GUEST@example.com' } })).toBe(true);
    expect(canSeeMigrateDemo({ user: { email: 'stranger@example.com' } })).toBe(false);
  });
  it('is false for signed-out / missing email', () => {
    process.env.KARABUDDY_MIGRATE_DEMO_EMAILS = 'owner@example.com';
    expect(canSeeMigrateDemo(null)).toBe(false);
    expect(canSeeMigrateDemo({ user: null })).toBe(false);
    expect(canSeeMigrateDemo({ user: { email: null } })).toBe(false);
  });
});
