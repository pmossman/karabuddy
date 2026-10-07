// Shared DATE-RANGE filter value (openings / replay browser / stats — one
// grammar everywhere, URL-param and filter-memory safe):
//   ''                        any time
//   '7d' | '30d' | '90d'      rolling presets (also bare '7' for legacy values)
//   '2026-06-01..2026-06-30'  explicit range, either side optional:
//   '2026-06-01..'            since a date
//   '..2026-06-30'            until a date (inclusive, end of day)
// UI: app/_components/DateRangeSelect.tsx. Parsing/labels live here so server
// code (the stats API) shares the exact same grammar.
//
// Explicit days are CALENDAR DAYS IN A TIME ZONE — the viewer's. "Oct 6" means
// local midnight to local midnight wherever the viewer is, so a US-evening game
// (already the next day in UTC) counts on the day it was played. Every caller
// must say which zone: the browser passes `localTimeZone()`, the server passes
// the zone the client sent (`normalizeTimeZone`, UTC when missing or bogus).
// A server that silently used its own zone (UTC on Vercel) was the bug this
// fixes. Presets stay relative to now and ignore the zone.

export interface DateRangeBounds {
  from: Date | null;
  to: Date | null; // inclusive — the last ms before the next local midnight
}

export interface DateRangeOptions {
  timeZone: string; // IANA zone the calendar days are read in; normalized (bogus → UTC)
  now?: Date; // anchor for the rolling presets
}

const DAY_MS = 86_400_000;
const PRESET_RE = /^(\d+)d?$/;
const RANGE_RE = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;

// ── Time zones ────────────────────────────────────────────────────────────────

// The canonical IANA name for `tz`, or 'UTC' when it's missing, malformed or
// unknown to the runtime. Offset strings ("+05:00") are refused: they carry no
// DST rules, so they can't mean "the viewer's days".
export function normalizeTimeZone(tz: string | null | undefined): string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(tz)) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// The zone this runtime is in — the viewer's, when called in the browser.
export function localTimeZone(): string {
  try {
    return normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
}

// One formatter per canonical zone (bounded by the IANA list).
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(tz: string): Intl.DateTimeFormat {
  let f = zoneFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    zoneFormatters.set(tz, f);
  }
  return f;
}

// Wall-clock fields read as if they were UTC, in ms. setUTCFullYear rather than
// Date.UTC, which maps years 0–99 to 1900+. Overflowing days roll into the next
// month (Feb 31 → Mar 3), the same as `new Date('YYYY-MM-DDT00:00:00')` did.
function wallMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  t.setUTCHours(h, mi, s, 0);
  return t.getTime();
}

// The zone's UTC offset (ms, east-positive) in force at instant `t`.
function zoneOffsetMs(t: number, tz: string): number {
  const p: Record<string, number> = {};
  for (const { type, value } of zoneFormatter(tz).formatToParts(t)) if (type !== 'literal') p[type] = Number(value);
  return wallMs(p.year, p.month, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
}

// The first instant of the local calendar day whose midnight, read as UTC, is
// `wall`. DST-correct: the offsets in force a day either side bracket any
// transition near this midnight, and each candidate is checked exactly.
function zonedMidnight(wall: number, tz: string): number {
  const offsets = new Set([zoneOffsetMs(wall - DAY_MS, tz), zoneOffsetMs(wall, tz), zoneOffsetMs(wall + DAY_MS, tz)]);
  const candidates = [...offsets].map((o) => wall - o).sort((a, b) => a - b);
  // Midnight exists → the earliest instant reading 00:00 (a repeated midnight counts from its first pass).
  for (const t of candidates) if (t + zoneOffsetMs(t, tz) === wall) return t;
  // Midnight skipped by a spring-forward (e.g. America/Santiago) → the day starts when the clocks jump.
  return wall - zoneOffsetMs(wall - DAY_MS, tz);
}

// ── The grammar ───────────────────────────────────────────────────────────────

function parseDay(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return [y, mo, d];
}

// True when the value names calendar days, so its bounds depend on the zone.
// Presets and '' don't — callers use this to keep the zone out of cache keys.
export function isDayRange(value: string | null | undefined): boolean {
  const m = (value ?? '').trim().match(RANGE_RE);
  return !!m && (!!(m[1] && parseDay(m[1])) || !!(m[2] && parseDay(m[2])));
}

export function dateRangeBounds(value: string | null | undefined, opts: DateRangeOptions): DateRangeBounds {
  const now = opts.now ?? new Date();
  const v = (value ?? '').trim();
  if (!v) return { from: null, to: null };
  const preset = v.match(PRESET_RE);
  if (preset) return { from: new Date(now.getTime() - Number(preset[1]) * DAY_MS), to: null };
  const m = v.match(RANGE_RE);
  if (!m) return { from: null, to: null }; // unknown token → no-op filter
  const tz = normalizeTimeZone(opts.timeZone);
  const fromDay = m[1] ? parseDay(m[1]) : null;
  const toDay = m[2] ? parseDay(m[2]) : null;
  return {
    from: fromDay ? new Date(zonedMidnight(wallMs(...fromDay), tz)) : null,
    // Up to the NEXT local midnight, not +24h: DST days are 23 or 25 hours long.
    to: toDay ? new Date(zonedMidnight(wallMs(toDay[0], toDay[1], toDay[2] + 1), tz) - 1) : null,
  };
}

// A membership test with the bounds resolved ONCE — for filtering many rows
// (resolving a day range costs a few Intl calls).
export function dateRangeFilter(value: string | null | undefined, opts: DateRangeOptions): (at: string | number | Date) => boolean {
  const { from, to } = dateRangeBounds(value, opts);
  return (at) => {
    const t = new Date(at).getTime();
    if (Number.isNaN(t)) return false;
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  };
}

export function inDateRange(at: string | number | Date, value: string | null | undefined, opts: DateRangeOptions): boolean {
  return dateRangeFilter(value, opts)(at);
}

const fmtDay = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function dateRangeLabel(value: string | null | undefined, anyLabel = 'Any time'): string {
  const v = (value ?? '').trim();
  if (!v) return anyLabel;
  const preset = v.match(PRESET_RE);
  if (preset) return `Past ${preset[1]} days`;
  const m = v.match(RANGE_RE);
  if (!m) return anyLabel;
  if (m[1] && m[2]) return `${fmtDay(m[1])} – ${fmtDay(m[2])}`;
  if (m[1]) return `Since ${fmtDay(m[1])}`;
  if (m[2]) return `Until ${fmtDay(m[2])}`;
  return anyLabel;
}
