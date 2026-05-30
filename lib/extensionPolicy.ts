// B72: the data behind GET /api/extension/status — the graduated extension
// kill-switch. Pure + dependency-free so it's trivially testable; the route
// supplies the live policy (env-overridable) and the caller's version.
//
// Tiers (see docs/extension-rollout.md):
//   ok    — silent, up to date.
//   nag   — behind `latestVersion` but still supported: show an "update
//           available" banner, keep working.
//   block — below `minSupportedVersion`: BREAK-GLASS only (a genuinely
//           broken/dangerous version). The extension should disable the
//           affected interaction but keep buffering recordings locally.
//
// Default posture is ok/nag; `block` only triggers when minSupportedVersion
// is deliberately raised. An unparseable/absent version → ok, so a client we
// can't identify is never bricked.

export interface ExtensionPolicy {
  minSupportedVersion: string;
  latestVersion: string;
  nagMessage?: string;
  blockMessage?: string;
}

export type ExtensionStatusTier = 'ok' | 'nag' | 'block';

export interface ExtensionStatus {
  status: ExtensionStatusTier;
  minSupportedVersion: string;
  latestVersion: string;
  message?: string;
}

// Compare dotted-integer versions (0.5.1 etc.). Missing trailing parts = 0.
// Returns -1 | 0 | 1. Non-numeric parts coerce to 0.
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

const VERSION_RE = /^\d+(\.\d+){0,3}$/;

export function evaluateExtensionStatus(
  version: string | undefined | null,
  policy: ExtensionPolicy,
): ExtensionStatus {
  const base = {
    minSupportedVersion: policy.minSupportedVersion,
    latestVersion: policy.latestVersion,
  };
  // Can't identify the client → don't brick it.
  if (!version || !VERSION_RE.test(version)) return { ...base, status: 'ok' };
  if (compareVersions(version, policy.minSupportedVersion) < 0) {
    return { ...base, status: 'block', message: policy.blockMessage };
  }
  if (compareVersions(version, policy.latestVersion) < 0) {
    return { ...base, status: 'nag', message: policy.nagMessage };
  }
  return { ...base, status: 'ok' };
}

// Live policy, env-overridable so it can be tuned without a code edit
// (a Vercel env change + redeploy). For an INSTANT flip without a deploy
// we'd move this to a DB row / Edge Config later — noted in B72.
export function currentExtensionPolicy(): ExtensionPolicy {
  return {
    // Reserve block: default minSupported to the floor so nobody is blocked
    // until we deliberately raise it.
    minSupportedVersion: process.env.KARABUDDY_EXT_MIN_SUPPORTED || '0.0.0',
    latestVersion: process.env.KARABUDDY_EXT_LATEST || '0.5.1',
    nagMessage: process.env.KARABUDDY_EXT_NAG_MESSAGE || 'A new version of KaraBuddy is available — reload to update.',
    blockMessage: process.env.KARABUDDY_EXT_BLOCK_MESSAGE || 'This version of KaraBuddy is out of date. Please update to keep recording.',
  };
}
