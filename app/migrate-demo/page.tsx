import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Migrate to SWU Forge — demo',
  description: 'Interactive demo of the karabuddy → SWU Forge team migration flow (faked data).',
  robots: { index: false, follow: false },
};

// Standalone, deployable DEMO of the karabuddy → SWU Forge team-migration flow.
// Faked data, no backend — for gathering feedback on the UX, not a real feature.
//
// The interactive prototype is a self-contained HTML document in
// public/demos/swuforge-migration.html (its own scoped styles + vanilla-JS state
// machine, including the per-step karabuddy→Forge aesthetic shift). We embed it
// full-screen here rather than porting it, so the deployed page is byte-identical
// to the reviewed prototype. It lives OUTSIDE the (app) group on purpose — the
// wizard has its own chrome and shouldn't sit inside the sidebar app shell.
export default function MigrateDemoPage() {
  return (
    <iframe
      src="/demos/swuforge-migration.html"
      title="karabuddy → SWU Forge migration demo"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
    />
  );
}
