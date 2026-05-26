import { Header } from '@/app/_components/Header';

// Wraps every "regular" page (homepage, /replays, /settings, /signin,
// /claim) with the persistent header. The replay viewer at /r/[slug]
// intentionally lives outside this group so it can render full-bleed
// with its own sidebar.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
