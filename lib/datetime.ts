// B203 (DRY foundations): shared date/time formatting. Previously `timeAgo`,
// `formatRelative`, `formatDate`, `formatDateShort`, `shortDate` were
// reimplemented ~8× across the replay/clip/team/mention surfaces, drifting in
// their null-handling and "just now"/seconds buckets. One source of truth here.

// "Ns/Nm/Nh/Nd ago" relative time. Null/invalid → '' (the guarded variant is
// canonical). `fallbackToDate` switches to an absolute date once past 7 days
// (the mentions-inbox behaviour) instead of an ever-growing "Nd ago".
export function relativeTime(iso: string | null | undefined, opts: { fallbackToDate?: boolean } = {}): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (opts.fallbackToDate && d >= 7) return new Date(iso).toLocaleDateString();
  return `${d}d ago`;
}

// Compact absolute timestamp: "M/D/YY, h:mm AM". Null/invalid → ''. `year:false`
// drops the year (the in-context "shortDate" variant); `time:false` drops the
// clock (date-only, for the old `toLocaleDateString` sites).
export function formatTimestamp(iso: string | null | undefined, opts: { year?: boolean; time?: boolean } = {}): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    ...(opts.year === false ? {} : { year: '2-digit' as const }),
    ...(opts.time === false ? {} : { hour: 'numeric' as const, minute: '2-digit' as const }),
  });
}
