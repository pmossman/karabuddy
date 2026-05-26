'use client';

import { signOut } from 'next-auth/react';
import { useSession } from 'next-auth/react';

// Small inline session widget — shows avatar + name + sign out for
// authenticated users, or a "Sign in" link for guests. Designed to drop
// into the viewer sidebar header.
export function SessionMenu({ compact = false }: { compact?: boolean }) {
  const { data: session, status } = useSession();
  if (status === 'loading') {
    return <div style={{ fontSize: 11, color: '#6c7588' }}>…</div>;
  }
  if (!session?.user) {
    return (
      <a
        href="/signin"
        style={{
          fontSize: 12,
          color: '#5da9ff',
          textDecoration: 'none',
          padding: '4px 8px',
          border: '1px solid #4a4e56',
          borderRadius: 4,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        Sign in
      </a>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {session.user.image && (
        <img
          src={session.user.image}
          alt=""
          style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0 }}
        />
      )}
      {!compact && (
        <span style={{ fontSize: 12, color: '#d6d6d6', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.user.name || session.user.email}
        </span>
      )}
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: window.location.href })}
        title="Sign out"
        style={{
          background: 'transparent',
          color: '#6c7588',
          border: 0,
          padding: '2px 6px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </div>
  );
}
