import type { Metadata } from 'next';
import MigrationDemo from './MigrationDemo';

// DEMO route: karabuddy → SWU Forge team migration (faked data, no backend — for
// feedback). Server page just for metadata; the interactive wizard is the client
// component MigrationDemo. Lives in the (app) group so it renders inside the real
// karabuddy shell (sidebar + header + footer).
export const metadata: Metadata = {
  title: 'Migrate to SWU Forge — demo',
  description: 'Interactive demo of the karabuddy → SWU Forge team migration (faked data).',
  robots: { index: false, follow: false },
};

export default function MigrateDemoPage() {
  return <MigrationDemo />;
}
