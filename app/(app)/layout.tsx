import { Header } from '@/app/_components/Header';
import { Footer } from '@/app/_components/Footer';

// Wraps every "regular" page (homepage, /replays, /settings, /signin,
// /claim, /privacy) with the persistent header + footer. The replay
// viewer at /r/[slug] intentionally lives outside this group so it can
// render full-bleed with its own sidebar.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <div style={{ flex: '1 1 auto' }}>{children}</div>
      <Footer />
    </div>
  );
}
