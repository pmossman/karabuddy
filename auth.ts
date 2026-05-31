import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb } from '@/lib/db';
import { users, accounts, sessions, verificationTokens } from '@/lib/schema';

// Auth.js v5 root config. Exports `auth()` for use in server components +
// API routes, and `handlers` for the [...nextauth]/route.ts.
//
// Path-2 friendly: providers list is purely additive. When karabast exposes
// OAuth (sometime later) we add a Karabast provider here, and existing
// Discord/Google-signed-in users can link a karabast account to the same
// users row via the accounts table — no schema change, no data migration.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    // allowDangerousEmailAccountLinking lets a user sign in via Discord
    // OR Google for the same email and land on the same users row (a new
    // account row is added in linked-accounts). Default is to refuse — the
    // "dangerous" label refers to providers that don't verify email, where
    // it could enable account takeover. Discord + Google both verify, so
    // it's safe here. When adding karabast as a provider later, only opt
    // it in once you've confirmed they verify email too.
    Discord({ allowDangerousEmailAccountLinking: true }),
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  session: { strategy: 'database' },
  pages: {
    signIn: '/signin',
  },
  callbacks: {
    async session({ session, user }) {
      // Expose our users.id on the session so the rest of the app can use it
      // without re-querying (Auth.js's default omits it). B84: attribution is
      // by account name — no karabast username.
      if (user) {
        (session.user as any).id = user.id;
      }
      return session;
    },
  },
});
