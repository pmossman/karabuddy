// Access gate for the /migrate-demo preview page (Parker + Andy only, in prod).
// Mirrors lib/admin.ts: an email allowlist via the KARABUDDY_MIGRATE_DEMO_EMAILS
// env var (comma-separated). Safe default — empty/unset means NOBODY can see it
// (the page 404s for everyone), so a missing env var never leaks the demo.
export function migrateDemoEmails(): string[] {
  return (process.env.KARABUDDY_MIGRATE_DEMO_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function canSeeMigrateDemo(
  session: { user?: { email?: string | null } | null } | null | undefined,
): boolean {
  const email = session?.user?.email?.toLowerCase();
  return !!email && migrateDemoEmails().includes(email);
}
