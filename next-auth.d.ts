import type { DefaultSession } from 'next-auth';

// Auth.js v5 omits our `users.id` from the session by default; the session
// callback in auth.ts mints it (`session.user.id = user.id`). Declare it here
// so the whole app reads `session.user.id` as a typed string instead of the
// `(session?.user as any)?.id` cast that used to live at ~80 call sites.
declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}
