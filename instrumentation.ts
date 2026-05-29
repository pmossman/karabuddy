// Next.js instrumentation hook. Runs once per server process at boot.
//
// The real body lives in lib/instrumentation-node.ts so Next's edge
// compiler never sees `process.cwd()` / drizzle-pglite imports. The
// dynamic import + NEXT_RUNTIME gate are the only things in this file.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { runNodeInstrumentation } = await import('@/lib/instrumentation-node');
  await runNodeInstrumentation();
}
