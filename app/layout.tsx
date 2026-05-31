import type { Metadata } from 'next';
import { Barlow, Orbitron } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { auth } from '@/auth';
import { AuthProvider } from '@/app/_components/AuthProvider';
import './globals.css';

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-barlow',
});

// Squared, geometric "space-HUD" face for the "BUDDY" logo mark (--font-logo).
// Orbitron is the canonical sci-fi display font; it carries the Star-Wars-esque
// HUD look the rounded mono couldn't. Swappable — change this import to try
// another (Oxanium, Michroma, Aldrich…).
const logoFont = Orbitron({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-logo',
});

export const metadata: Metadata = {
  title: 'KaraBuddy',
  description: 'Replays, solo testing, and review tools for Star Wars Unlimited.',
};

// AppRouterCacheProvider streams emotion's <style> blocks during SSR so
// hydration matches. AuthProvider wraps SessionProvider — read the session
// server-side and hand it down so useSession() in children has data on
// the first render.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className={`${barlow.variable} ${logoFont.variable}`}>
      <body>
        <AppRouterCacheProvider>
          <AuthProvider session={session}>{children}</AuthProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
