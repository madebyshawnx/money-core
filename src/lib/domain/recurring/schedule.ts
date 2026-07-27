/**
 * Recurring schedule math — projecting when an obligation next falls due.
 *
 * The docs require deterministic cash-flow projection (docs/16: "Can generate
 * deterministic cash-flow forecast in tests") but do not define calendar
 * semantics (NOT SPECIFIED), so the rules are fixed here and shared by the
 * recurring detector and (later) the forecast engine:
 *   - WEEKLY/BIWEEKLY advance by a fixed 7/14 days.
 *   - MONTHLY/QUARTERLY/ANNUAL advance by 1/3/12 calendar months, preserving the
 *     day-of-month and clamping to the last day of a shorter month
 *     (Jan 31 + 1mo → Feb 28).
 *   - IRREGULAR is not projectable.
 *
 * All functions are pure and UTC-based — no local timezone, no clock, no RNG.
 */

import type { RecurringFrequency } from "@/lib/domain/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Safety bound so occurrencesBetween can never loop unbounded on a bad window. */
const MAX_OCCURRENCES = 1000;

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

/** The next occurrence one period after `anchor`, or undefined for IRREGULAR. */
export function nextOccurrence(anchor: Date, frequency: RecurringFrequency): Date | undefined {
  const days = DAYS_PER_STEP[frequency];
  if (days !== undefined) return new Date(anchor.getTime() + days * MS_PER_DAY);
  const months = MONTHS_PER_STEP[frequency];
  if (months !== undefined) return addMonthsFromAnchor(anchor, months, anchor.getUTCDate());
  return undefined; // IRREGULAR
}

function occurrenceAtStep(anchor: Date, frequency: RecurringFrequency, step: number): Date | undefined {
  const days = DAYS_PER_STEP[frequency];
  if (days !== undefined) return new Date(anchor.getTime() + step * days * MS_PER_DAY);
  const months = MONTHS_PER_STEP[frequency];
  if (months !== undefined) return addMonthsFromAnchor(anchor, step * months, anchor.getUTCDate());
  return undefined;
}

/** The first expected occurrence strictly after `asOf`, stepping from `lastOccurrence`. */
export function projectNextExpected(
  lastOccurrence: Date,
  frequency: RecurringFrequency,
  asOf: Date,
): Date | undefined {
  if (nextOccurrence(lastOccurrence, frequency) === undefined) return undefined; // IRREGULAR
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    const candidate = occurrenceAtStep(lastOccurrence, frequency, i);
    if (candidate === undefined) return undefined;
    if (candidate.getTime() > asOf.getTime()) return candidate;
  }
  return occurrenceAtStep(lastOccurrence, frequency, MAX_OCCURRENCES);
}

/** Every occurrence within [start, end] (inclusive), stepping forward from `anchor`. */
export function occurrencesBetween(
  anchor: Date,
  frequency: RecurringFrequency,
  start: Date,
  end: Date,
): Date[] {
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
