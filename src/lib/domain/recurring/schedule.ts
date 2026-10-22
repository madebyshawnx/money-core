/**
 * Recurring schedule math — projecting when an obligation next falls due.
 *
 * The docs require deterministic cash-flow projection (docs/16: "Can generate
 * deterministic cash-flow forecast in tests") but do not define calendar
 * semantics (NOT SPECIFIED), so the rules are fixed here and shared by the
 * recurring detector and (later) the forecast engine:
 *   - WEEKLY/BIWEEKLY advance by a fixed 7/14 days.
 *   - SEMI_MONTHLY falls on listed days of every month (`daysOfMonth`, e.g.
 *     [1, 15]); a day past a month's end lands on that month's last day
 *     (31 → Feb 28). Without valid days it is not projectable.
 *   - MONTHLY/QUARTERLY/ANNUAL advance by 1/3/12 calendar months, preserving the
 *     day-of-month and clamping to the last day of a shorter month
 *     (Jan 31 + 1mo → Feb 28).
 *   - IRREGULAR is not projectable.
 *   - Every cadence but SEMI_MONTHLY needs an ANCHOR — a known occurrence to
 *     step from. Without one there are no dates: nothing else places a 14-day
 *     cycle on the calendar. SEMI_MONTHLY is placed by its days; an anchor, when
 *     given, only bounds it, exactly as for the other cadences (no date before
 *     the anchor).
 *
 * All functions are pure and UTC-based — no local timezone, no clock, no RNG.
 */

import type { RecurringFrequency } from "@/lib/domain/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Safety bound so occurrencesBetween can never loop unbounded on a bad window. */
const MAX_OCCURRENCES = 1000;
/** The longest month's last day — the highest SEMI_MONTHLY day that means anything. */
const MAX_DAY_OF_MONTH = 31;
/** SEMI_MONTHLY falls on exactly this many days of every month. */
const SEMI_MONTHLY_DAY_COUNT = 2;

const MONTHS_PER_STEP: Partial<Record<RecurringFrequency, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

const DAYS_PER_STEP: Partial<Record<RecurringFrequency, number>> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
};

/**
 * Days in a UTC month (`month` may run past 11 into later years). The ONE
 * month-length rule in the recurring engine: month-end clamping for every
 * cadence comes through here, and detection reads it via `occurrencesBetween`.
 */
function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Add whole calendar months in UTC from an anchor day, clamping only in the target month. */
function addMonthsFromAnchor(date: Date, months: number, anchorDay: number): Date {
  const base = new Date(date.getTime());
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  base.setUTCDate(Math.min(anchorDay, daysInUtcMonth(base.getUTCFullYear(), base.getUTCMonth())));
  return base;
}

/**
 * SEMI_MONTHLY's two days in ascending order, or undefined unless there are
 * exactly two different whole days 1–31. Anything else is refused whole, never
 * partly used: the cadence is twice a month (24 a year) by definition, and a
 * projection from a corrupted list would look valid and be wrong.
 */
function validDaysOfMonth(daysOfMonth: readonly number[] | undefined): number[] | undefined {
  if (daysOfMonth === undefined) return undefined;
  const days = [...daysOfMonth].sort((a, b) => a - b);
  const isWholeDay = (day: number) => Number.isInteger(day) && day >= 1 && day <= MAX_DAY_OF_MONTH;
  const isValid = days.length === SEMI_MONTHLY_DAY_COUNT && days[0] !== days[1] && days.every(isWholeDay);
  return isValid ? days : undefined;
}

/**
 * SEMI_MONTHLY dates at or after `from` (and at or before `to`, when given), in
 * order, at most `limit` of them, walking month by month from the month of
 * `from`. Each day lands on that day of the month, or on the month's last day
 * when the month is shorter; two days that land on the same date count once.
 * Dates carry the anchor's UTC time of day (midnight without one), so an
 * anchored schedule compares like the other cadences.
 */
function semiMonthlyDates(
  days: readonly number[],
  anchor: Date | undefined,
  from: Date,
  to: Date | undefined,
  limit: number,
): Date[] {
  const timeOfDayMs =
    anchor === undefined ? 0 : anchor.getTime() - Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const out: Date[] = [];
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  for (let offset = 0; offset < MAX_OCCURRENCES && out.length < limit; offset += 1) {
    if (to !== undefined && Date.UTC(year, month + offset, 1) > to.getTime()) break;
    const lastDay = daysInUtcMonth(year, month + offset);
    for (const day of days) {
      const time = Date.UTC(year, month + offset, Math.min(day, lastDay)) + timeOfDayMs;
      const isNew = time >= from.getTime() && time !== out.at(-1)?.getTime();
      const isInWindow = to === undefined || time <= to.getTime();
      if (isNew && isInWindow && out.length < limit) out.push(new Date(time));
    }
  }
  return out;
}

/**
 * The next occurrence one period after `anchor`, or undefined when an anchor
 * alone cannot place it: IRREGULAR, and SEMI_MONTHLY (which needs its days of
 * the month — see `projectNextExpected` / `occurrencesBetween`).
 */
export function nextOccurrence(anchor: Date, frequency: RecurringFrequency): Date | undefined {
  const days = DAYS_PER_STEP[frequency];
  if (days !== undefined) return new Date(anchor.getTime() + days * MS_PER_DAY);
  const months = MONTHS_PER_STEP[frequency];
  if (months !== undefined) return addMonthsFromAnchor(anchor, months, anchor.getUTCDate());
  return undefined; // IRREGULAR, SEMI_MONTHLY
}

function occurrenceAtStep(anchor: Date, frequency: RecurringFrequency, step: number): Date | undefined {
  const days = DAYS_PER_STEP[frequency];
  if (days !== undefined) return new Date(anchor.getTime() + step * days * MS_PER_DAY);
  const months = MONTHS_PER_STEP[frequency];
  if (months !== undefined) return addMonthsFromAnchor(anchor, step * months, anchor.getUTCDate());
  return undefined;
}

/**
 * The first expected occurrence strictly after `asOf`, stepping from `lastOccurrence`.
 * SEMI_MONTHLY reads `daysOfMonth` (every other cadence ignores it) and is
 * undefined without valid days; it never projects a date before `lastOccurrence`.
 */
export function projectNextExpected(
  lastOccurrence: Date,
  frequency: RecurringFrequency,
  asOf: Date,
  daysOfMonth?: readonly number[],
): Date | undefined {
  if (frequency === "SEMI_MONTHLY") {
    const days = validDaysOfMonth(daysOfMonth);
    if (days === undefined) return undefined;
    const afterAsOf = new Date(asOf.getTime() + 1);
    const from = lastOccurrence.getTime() > afterAsOf.getTime() ? lastOccurrence : afterAsOf;
    return semiMonthlyDates(days, lastOccurrence, from, undefined, 1)[0];
  }
  if (nextOccurrence(lastOccurrence, frequency) === undefined) return undefined; // IRREGULAR
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    const candidate = occurrenceAtStep(lastOccurrence, frequency, i);
    if (candidate === undefined) return undefined;
    if (candidate.getTime() > asOf.getTime()) return candidate;
  }
  return occurrenceAtStep(lastOccurrence, frequency, MAX_OCCURRENCES);
}

/**
 * Every occurrence within [start, end] (inclusive), stepping forward from
 * `anchor` — never a date before it. Every cadence but SEMI_MONTHLY needs the
 * anchor and yields no dates without one. SEMI_MONTHLY falls on `daysOfMonth`
 * (every other cadence ignores it); its anchor is optional and only bounds it.
 */
export function occurrencesBetween(
  anchor: Date | undefined,
  frequency: RecurringFrequency,
  start: Date,
  end: Date,
  daysOfMonth?: readonly number[],
): Date[] {
  if (frequency === "SEMI_MONTHLY") {
    const days = validDaysOfMonth(daysOfMonth);
    if (days === undefined) return [];
    const from = anchor !== undefined && anchor.getTime() > start.getTime() ? anchor : start;
    return semiMonthlyDates(days, anchor, from, end, MAX_OCCURRENCES);
  }
  if (anchor === undefined) return []; // nothing places a fixed-interval cadence without an anchor
  if (nextOccurrence(anchor, frequency) === undefined) return []; // IRREGULAR
  const out: Date[] = [];
  let step = 0;
  let candidate = anchor;
  // Fast-forward to the first occurrence at or after the window start.
  for (let i = 0; i < MAX_OCCURRENCES && candidate.getTime() < start.getTime(); i += 1) {
    step += 1;
    const advanced = occurrenceAtStep(anchor, frequency, step);
    if (advanced === undefined) return out;
    candidate = advanced;
  }
  for (let i = 0; i < MAX_OCCURRENCES && candidate.getTime() <= end.getTime(); i += 1) {
    out.push(candidate);
    step += 1;
    const advanced = occurrenceAtStep(anchor, frequency, step);
    if (advanced === undefined) break;
    candidate = advanced;
  }
  return out;
}
