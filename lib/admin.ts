// B157: admin gating for the internal dashboard (/admin). Allowlist by email via
// the KARABUDDY_ADMIN_EMAILS env var (comma-separated). No DB role column — this
// is a tiny operator allowlist, not a user-facing permission. Safe default: an
// empty/unset env means NOBODY is admin (the page 404s for everyone).

export function adminEmails(): string[] {
  return (process.env.KARABUDDY_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

// Accepts an Auth.js session (database strategy → session.user.email is the
// account email). Returns false for signed-out / non-allowlisted users.
export function isAdmin(session: { user?: { email?: string | null } | null } | null | undefined): boolean {
  return isAdminEmail(session?.user?.email ?? null);
}
