import type { Metadata } from 'next';
import { Barlow, Chakra_Petch } from 'next/font/google';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { auth } from '@/auth';
import { AuthProvider } from '@/app/_components/AuthProvider';
import './globals.css';

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-barlow',
});

// Techy display face for the "buddy" logo mark (--font-logo) — squared,
// futuristic, pairs with Barlow and matches the tactical/electric theme far
// better than the old serif. Swappable: change this import to try another.
const logoFont = Chakra_Petch({
  subsets: ['latin'],
  weight: ['600', '700'],
  style: ['italic'],
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
