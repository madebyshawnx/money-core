/**
 * Recurring obligation detection — infer bills/subscriptions/paychecks from history.
 *
 * docs/10 Phase-4 deliverables include a "Recurring detection" service; docs/33
 * requires "Detected recurring items require confirmation". The docs do NOT give
 * numeric thresholds (min occurrences, amount tolerance, cadence buckets,
 * confidence), so those are named constants here and documented as heuristics.
 *
 * Detected obligations are always UNCONFIRMED (`isConfirmed: false`,
 * `includeInForecast: false`) — the user must approve them before they influence
 * the forecast (mirrors the seeded newly-detected CloudFit subscription).
 *
 * Pure and deterministic: caller supplies `asOf`; obligations are returned in a
 * stable id order.
 */

import type { RecurringFrequency, RecurringObligation, RecurringType, Transaction } from "@/lib/domain/types";
import { occurrencesBetween, projectNextExpected } from "./schedule";

/** Minimum matching transactions before a merchant is treated as recurring. */
export const MIN_OCCURRENCES_FOR_RECURRING = 2;
/** A recurring outflow at or below this magnitude is treated as a subscription, else a bill. */
export const SUBSCRIPTION_MAX_CENTS = 5000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A twice-monthly series must repeat a day of the month (so ≥ 3 dates) before it is pinned to the calendar. */
const MIN_OCCURRENCES_FOR_SEMI_MONTHLY = 3;
/** Spacing of exactly this many days throughout is BIWEEKLY, even where it also fits two days of the month. */
const BIWEEKLY_GAP_DAYS = 14;
/** The highest day a SEMI_MONTHLY pair can name; the schedule lands 31 on every month's last day. */
const MAX_DAY_OF_MONTH = 31;
/**
 * A semi-monthly pair's day NUMBERS sit 15 ± 2 apart (second − first, a month's
 * last day read as 31): a day-number proxy for splitting the month in half, not
 * a measure of the calendar days between paydays.
 */
const SEMI_MONTHLY_SPACING_DAYS = 15;
const SEMI_MONTHLY_SPACING_TOLERANCE_DAYS = 2;
/** A weekend payday moves at most two days (Sunday → Friday, Saturday → Monday). */
const MAX_WEEKEND_MOVE_DAYS = 2;
const SUNDAY = 0;
const SATURDAY = 6;
/**
 * The most confidence a semi-monthly fit gets when any date fit only through a
 * weekend move or a month-end clamp: "worth a careful look" (Medium, 50–79, on
 * this package's ConfidenceMeter), never "basically certain" (High, 80+).
 */
const TOLERANT_FIT_MAX_CONFIDENCE = 60;

/** States that represent real, countable activity for detection. */
const DETECTABLE_STATES: ReadonlySet<Transaction["state"]> = new Set([
  "PENDING",
  "POSTED",
  "NEEDS_REVIEW",
  "AUTO_CLASSIFIED",
  "USER_CONFIRMED",
]);

export interface DetectContext {
  asOf: Date;
}

function isDetectable(t: Transaction): boolean {
  return (
    DETECTABLE_STATES.has(t.state) &&
    t.replacementTransactionId == null &&
    t.transferGroupId == null &&
    t.merchantNormalized != null
  );
}

export function detectRecurring(transactions: Transaction[], ctx: DetectContext): RecurringObligation[] {
  // Group by normalized merchant + flow direction (inflow vs outflow).
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isDetectable(t)) continue;
    const direction = t.amountCents >= 0 ? "in" : "out";
    const key = `${t.merchantNormalized}|${direction}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const obligations: RecurringObligation[] = [];
  for (const members of groups.values()) {
    const obligation = inferObligation(members, ctx);
    if (obligation) obligations.push(obligation);
  }
  return obligations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function inferObligation(members: Transaction[], ctx: DetectContext): RecurringObligation | undefined {
  if (members.length < MIN_OCCURRENCES_FOR_RECURRING) return undefined;

  const sorted = [...members].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
  const magnitudes = sorted.map((t) => Math.abs(t.amountCents));
  if (!amountsAreStable(magnitudes)) return undefined;

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i]!.transactionDate.getTime() - sorted[i - 1]!.transactionDate.getTime()) / MS_PER_DAY);
  }
  const gapFrequency = inferFrequency(gaps);
  const semiMonthly = gapFrequency === "BIWEEKLY" ? semiMonthlyFit(sorted, gaps) : undefined;
  const frequency: RecurringFrequency = semiMonthly === undefined ? gapFrequency : "SEMI_MONTHLY";
  const daysOfMonth = semiMonthly?.days;

  const latest = sorted[sorted.length - 1]!;
  const merchant = latest.merchantNormalized!;
  const amountCents = latest.amountCents;

  return {
    id: `rec_${stableKey(merchant)}`,
    householdId: latest.householdId,
    type: inferType(amountCents, frequency),
    name: merchant,
    merchantNormalized: merchant,
    amountCents,
    frequency,
    ...(daysOfMonth === undefined ? {} : { daysOfMonth }),
    nextExpectedDate: projectNextExpected(latest.transactionDate, frequency, ctx.asOf, daysOfMonth),
    confidenceScore: confidenceFor(sorted.length, frequency, semiMonthly?.isTolerant === true),
    isConfirmed: false,
    isActive: true,
    includeInForecast: false,
    accountId: latest.accountId,
  };
}

/** All magnitudes must sit within a tolerance band of the median to count as stable. */
function amountsAreStable(magnitudes: number[]): boolean {
  const med = median(magnitudes);
  const tolerance = Math.max(500, med * 0.15);
  return magnitudes.every((m) => Math.abs(m - med) <= tolerance);
}

function inferFrequency(gaps: number[]): RecurringFrequency {
  const g = median(gaps);
  if (near(g, 7, 2)) return "WEEKLY";
  if (near(g, 14, 3)) return "BIWEEKLY";
  if (near(g, 30.4, 6)) return "MONTHLY";
  if (near(g, 91, 12)) return "QUARTERLY";
  if (near(g, 365, 25)) return "ANNUAL";
  return "IRREGULAR";
}

/**
 * The semi-monthly reading of a series the gaps call BIWEEKLY, or undefined.
 *
 * Gaps alone cannot tell SEMI_MONTHLY from BIWEEKLY: a 1st/15th paycheck's
 * 14/16/17-day gaps sit inside BIWEEKLY's 14±3 band. The calendar helps — a
 * biweekly series drifts 2–3 days of the month every month; a semi-monthly one
 * does not. The series reads as SEMI_MONTHLY only when:
 *   - a pair of day numbers fits EVERY date: each lands on its day where the
 *     schedule puts it (a day past a month's end lands on the last day: a
 *     CLAMP) or, when that day is a Saturday or Sunday, on the Friday before
 *     or the Monday after (a WEEKEND MOVE);
 *   - the BEST such pair (fewest weekend moves, then the higher day numbers, so
 *     a month's last day reads as 31) has day numbers 15 ± 2 apart. That is
 *     second − first on day numbers, not the calendar days between paydays.
 *     A worse-fitting pair is never substituted, so Feb 13, Feb 28, Mar 13
 *     (best read as 13 and 31, 18 apart) stays BIWEEKLY;
 *   - a day repeats (≥ 3 dates), and not every gap is exactly 14 days.
 * `isTolerant` marks a fit in which any date needed a weekend move or a clamp;
 * its confidence is capped at TOLERANT_FIT_MAX_CONFIDENCE.
 *
 * KNOWN LIMITS, stated plainly:
 *   - FALSE POSITIVES. A biweekly series disturbed by one holiday or one late
 *     posting can still fit a balanced pair, in any month and in 4–5-date
 *     series too (Labor Day: Sep 4, Sep 21, Oct 5, Oct 19 reads as [5, 19]).
 *     Most such fits need a weekend move or a clamp and are capped; an
 *     exact-day coincidence (Jan 16, Feb 2, Feb 16 reads as [2, 16]) keeps
 *     full confidence. Detected obligations stay unconfirmed and out of the
 *     forecast until a person confirms them.
 *   - FALSE NEGATIVES. Holidays are not modelled: a payday moved for one fits
 *     only by coincidence, so a genuine series with such a move usually stays
 *     BIWEEKLY, as does one whose best fit is uneven.
 * Weighing a competing biweekly reading is deferred to Task 1b.6 of the Money
 * Manager roadmap (the recurring-detection noise floor).
 */
function semiMonthlyFit(
  sorted: readonly Transaction[],
  gaps: readonly number[],
): { days: number[]; isTolerant: boolean } | undefined {
  if (sorted.length < MIN_OCCURRENCES_FOR_SEMI_MONTHLY) return undefined;
  if (gaps.every((gap) => Math.round(gap) === BIWEEKLY_GAP_DAYS)) return undefined;
  const observedDays = sorted.map((t) => Math.floor(t.transactionDate.getTime() / MS_PER_DAY));
  const windowStart = new Date((observedDays[0]! - MAX_WEEKEND_MOVE_DAYS) * MS_PER_DAY);
  const windowEnd = new Date((observedDays[observedDays.length - 1]! + MAX_WEEKEND_MOVE_DAYS) * MS_PER_DAY);
  let best: { first: number; second: number; weekendMoves: number; clampedHits: number } | undefined;
  for (let second = MAX_DAY_OF_MONTH; second > 1; second -= 1) {
    for (let first = second - 1; first >= 1; first -= 1) {
      const pair = [first, second];
      const fit = fitAgainst(observedDays, occurrencesBetween(undefined, "SEMI_MONTHLY", windowStart, windowEnd, pair), pair);
      if (fit !== undefined && (best === undefined || fit.weekendMoves < best.weekendMoves)) {
        best = { first, second, ...fit };
      }
    }
  }
  if (best === undefined) return undefined;
  const isBalanced = near(best.second - best.first, SEMI_MONTHLY_SPACING_DAYS, SEMI_MONTHLY_SPACING_TOLERANCE_DAYS);
  if (!isBalanced) return undefined;
  return { days: [best.first, best.second], isTolerant: best.weekendMoves > 0 || best.clampedHits > 0 };
}

/**
 * How the observed days fit a pair's scheduled dates, or undefined when some
 * observed day fits none. `weekendMoves` counts days on the Friday before or
 * the Monday after a Saturday/Sunday payday; `clampedHits` counts days that
 * fit only because a shorter month clamped the pair's day there (30 → Feb 28).
 */
function fitAgainst(
  observedDays: readonly number[],
  scheduled: readonly Date[],
  pair: readonly number[],
): { weekendMoves: number; clampedHits: number } | undefined {
  const onTheDay = new Set<number>();
  const clampedThere = new Set<number>();
  const movedForWeekend = new Set<number>();
  for (const date of scheduled) {
    const day = Math.floor(date.getTime() / MS_PER_DAY);
    if (pair.includes(date.getUTCDate())) onTheDay.add(day);
    else clampedThere.add(day);
    if (date.getUTCDay() === SATURDAY) movedForWeekend.add(day - 1).add(day + 2);
    if (date.getUTCDay() === SUNDAY) movedForWeekend.add(day - 2).add(day + 1);
  }
  let weekendMoves = 0;
  let clampedHits = 0;
  for (const day of observedDays) {
    if (onTheDay.has(day)) continue;
    if (clampedThere.has(day)) clampedHits += 1;
    else if (movedForWeekend.has(day)) weekendMoves += 1;
    else return undefined;
  }
  return { weekendMoves, clampedHits };
}

function inferType(amountCents: number, frequency: RecurringFrequency): RecurringType {
  if (amountCents > 0) return "PAYCHECK";
  if (Math.abs(amountCents) <= SUBSCRIPTION_MAX_CENTS) return "SUBSCRIPTION";
  void frequency;
  return "BILL";
}

function confidenceFor(count: number, frequency: RecurringFrequency, isTolerantFit: boolean): number {
  if (frequency === "IRREGULAR") return 40;
  const clean = Math.min(95, 55 + count * 10); // 2→75, 3→85, 4+→95
  return isTolerantFit ? Math.min(clean, TOLERANT_FIT_MAX_CONFIDENCE) : clean; // a tolerant semi-monthly fit → 60
}

function near(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function stableKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
