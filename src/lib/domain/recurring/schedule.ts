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

const MONTHS_PER_STEP: Partial<Record<RecurringFrequency, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

const DAYS_PER_STEP: Partial<Record<RecurringFrequency, number>> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
};

/** Add whole calendar months in UTC from an anchor day, clamping only in the target month. */
function addMonthsFromAnchor(date: Date, months: number, anchorDay: number): Date {
  const base = new Date(date.getTime());
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0),
  ).getUTCDate();
  base.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
  return base;
}

/** Milliseconds past UTC midnight — the time of day an anchored SEMI_MONTHLY date carries. */
function utcTimeOfDayMs(date: Date): number {
  return date.getTime() - Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * SEMI_MONTHLY days in ascending order, or undefined when there are none or any
 * is not a whole day 1–31. A corrupt list is refused, never partly used: a
 * projection from the surviving days would look valid and be wrong.
 */
function validDaysOfMonth(daysOfMonth: readonly number[] | undefined): number[] | undefined {
  if (daysOfMonth === undefined || daysOfMonth.length === 0) return undefined;
  const isValid = daysOfMonth.every((day) => Number.isInteger(day) && day >= 1 && day <= MAX_DAY_OF_MONTH);
  return isValid ? [...daysOfMonth].sort((a, b) => a - b) : undefined;
}

/**
 * SEMI_MONTHLY dates at or after `from` (and at or before `to`, when given), in
 * order, at most `limit` of them — walking month by month from the month of
 * `from`. Days that land on the same date in a short month (30 and 31 in
 * February) count once, so the output strictly increases.
 */
function semiMonthlyDates(
  days: readonly number[],
  timeOfDayMs: number,
  from: Date,
  to: Date | undefined,
  limit: number,
): Date[] {
  const out: Date[] = [];
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  for (let offset = 0; offset < MAX_OCCURRENCES; offset += 1) {
    const lastDay = new Date(Date.UTC(year, month + offset + 1, 0)).getUTCDate();
    for (const day of days) {
      const time = Date.UTC(year, month + offset, Math.min(day, lastDay)) + timeOfDayMs;
      if (time < from.getTime() || time === out.at(-1)?.getTime()) continue;
      const isWithinWindow = to === undefined || time <= to.getTime();
      if (!isWithinWindow || out.length >= limit) return out;
      out.push(new Date(time));
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
    return semiMonthlyDates(days, utcTimeOfDayMs(lastOccurrence), from, undefined, 1)[0];
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
  if (frequency === "SEMI_MONTHLY") return semiMonthlyBetween(anchor, daysOfMonth, start, end);
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

/** SEMI_MONTHLY dates in [start, end]: from the later of `start` and the anchor, at the anchor's time of day. */
function semiMonthlyBetween(
  anchor: Date | undefined,
  daysOfMonth: readonly number[] | undefined,
  start: Date,
  end: Date,
): Date[] {
  const days = validDaysOfMonth(daysOfMonth);
  if (days === undefined) return [];
  if (anchor === undefined) return semiMonthlyDates(days, 0, start, end, MAX_OCCURRENCES);
  const from = anchor.getTime() > start.getTime() ? anchor : start;
  return semiMonthlyDates(days, utcTimeOfDayMs(anchor), from, end, MAX_OCCURRENCES);
}
