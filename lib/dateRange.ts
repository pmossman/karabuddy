// Shared DATE-RANGE filter value (openings / replay browser / stats — one
// grammar everywhere, URL-param and filter-memory safe):
//   ''                        any time
//   '7d' | '30d' | '90d'      rolling presets (also bare '7' for legacy values)
//   '2026-06-01..2026-06-30'  explicit range, either side optional:
//   '2026-06-01..'            since a date
//   '..2026-06-30'            until a date (inclusive, end of day)
// UI: app/_components/DateRangeSelect.tsx. Parsing/labels live here so server
// code (the stats API) shares the exact same grammar.

export interface DateRangeBounds {
  from: Date | null;
  to: Date | null; // inclusive — already advanced to end-of-day
}

const DAY_MS = 86_400_000;

function parseDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateRangeBounds(value: string | null | undefined, now: Date = new Date()): DateRangeBounds {
  const v = (value ?? '').trim();
  if (!v) return { from: null, to: null };
  const preset = v.match(/^(\d+)d?$/);
  if (preset) return { from: new Date(now.getTime() - Number(preset[1]) * DAY_MS), to: null };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/);
  if (!m) return { from: null, to: null }; // unknown token → no-op filter
  const from = m[1] ? parseDay(m[1]) : null;
  const toDay = m[2] ? parseDay(m[2]) : null;
  return { from, to: toDay ? new Date(toDay.getTime() + DAY_MS - 1) : null };
}

export function inDateRange(at: string | number | Date, value: string | null | undefined, now: Date = new Date()): boolean {
  const { from, to } = dateRangeBounds(value, now);
  const t = new Date(at).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < from.getTime()) return false;
  if (to && t > to.getTime()) return false;
  return true;
}

const fmtDay = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function dateRangeLabel(value: string | null | undefined, anyLabel = 'Any time'): string {
  const v = (value ?? '').trim();
  if (!v) return anyLabel;
  const preset = v.match(/^(\d+)d?$/);
  if (preset) return `Past ${preset[1]} days`;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/);
  if (!m) return anyLabel;
  if (m[1] && m[2]) return `${fmtDay(m[1])} – ${fmtDay(m[2])}`;
  if (m[1]) return `Since ${fmtDay(m[1])}`;
  if (m[2]) return `Until ${fmtDay(m[2])}`;
  return anyLabel;
}
