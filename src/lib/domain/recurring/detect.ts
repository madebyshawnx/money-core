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
/** Semi-monthly splits the month roughly in half: its two days sit 15 ± 2 days apart. */
const SEMI_MONTHLY_SPACING_DAYS = 15;
const SEMI_MONTHLY_SPACING_TOLERANCE_DAYS = 2;
/** A weekend payday moves at most two days (Sunday → Friday, Saturday → Monday). */
const MAX_WEEKEND_MOVE_DAYS = 2;
const SUNDAY = 0;
const SATURDAY = 6;

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
  const daysOfMonth = gapFrequency === "BIWEEKLY" ? pinnedDaysOfMonth(sorted, gaps) : undefined;
  const frequency: RecurringFrequency = daysOfMonth === undefined ? gapFrequency : "SEMI_MONTHLY";

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
    confidenceScore: confidenceFor(sorted.length, frequency),
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
 * The two days of the month a twice-monthly series is pinned to, or undefined.
 *
 * Gaps alone cannot tell SEMI_MONTHLY from BIWEEKLY: a 1st/15th paycheck's
 * 14/16/17-day gaps sit inside BIWEEKLY's 14±3 band. The calendar can — a
 * biweekly series drifts 2–3 days of the month every month; a semi-monthly one
 * does not. So a series the gaps call BIWEEKLY is SEMI_MONTHLY only when:
 *   - a pair of days explains EVERY date: each lands on its day exactly where
 *     the schedule puts it (a day past a month's end on the last day) or, when
 *     that day is a Saturday or Sunday, on the Friday before or the Monday
 *     after — the usual payroll rule;
 *   - the BEST such pair — fewest weekend moves, then the later days — splits
 *     the month roughly in half (15 ± 2 days apart), which is what semi-monthly
 *     means. "Later days first" makes a month's last day read as 31 (the last
 *     day) unless another date pins a literal 28th–30th, so a Feb 28 payday
 *     projects Mar 31, not Mar 28. A worse-fitting balanced pair is never
 *     substituted: a biweekly series posted a day late on Feb 28 (Feb 13,
 *     Feb 28, Mar 13) reads best as "13th and last day", 18 apart, and stays
 *     BIWEEKLY;
 *   - a day repeats (≥ 3 dates) — any two dates fit two days and prove nothing;
 *   - not every gap is exactly 14 days: constant 14-day spacing stays BIWEEKLY
 *     even where a short February lets it fit two days (Feb 1, Feb 15, Mar 1).
 * DEFERRED, deliberately: holidays. A payday moved for a public holiday breaks
 * the pin and the series keeps its gap-based cadence; only weekend moves are
 * recognised.
 */
function pinnedDaysOfMonth(sorted: readonly Transaction[], gaps: readonly number[]): number[] | undefined {
  if (sorted.length < MIN_OCCURRENCES_FOR_SEMI_MONTHLY) return undefined;
  if (gaps.every((gap) => Math.round(gap) === BIWEEKLY_GAP_DAYS)) return undefined;
  const observedDays = sorted.map((t) => Math.floor(t.transactionDate.getTime() / MS_PER_DAY));
  const windowStart = new Date((observedDays[0]! - MAX_WEEKEND_MOVE_DAYS) * MS_PER_DAY);
  const windowEnd = new Date((observedDays[observedDays.length - 1]! + MAX_WEEKEND_MOVE_DAYS) * MS_PER_DAY);
  let best: { first: number; second: number; weekendMoves: number } | undefined;
  for (let second = MAX_DAY_OF_MONTH; second > 1; second -= 1) {
    for (let first = second - 1; first >= 1; first -= 1) {
      const scheduled = occurrencesBetween(undefined, "SEMI_MONTHLY", windowStart, windowEnd, [first, second]);
      const weekendMoves = weekendMovesToFit(observedDays, scheduled);
      if (weekendMoves !== undefined && (best === undefined || weekendMoves < best.weekendMoves)) {
        best = { first, second, weekendMoves };
      }
    }
  }
  if (best === undefined) return undefined;
  const isBalanced = near(best.second - best.first, SEMI_MONTHLY_SPACING_DAYS, SEMI_MONTHLY_SPACING_TOLERANCE_DAYS);
  return isBalanced ? [best.first, best.second] : undefined;
}

/**
 * How many observed days needed a weekend move to land on a scheduled date — a
 * payday on a Saturday or Sunday is paid the Friday before or the Monday after
 * — or undefined when some observed day fits no scheduled date at all.
 */
function weekendMovesToFit(observedDays: readonly number[], scheduled: readonly Date[]): number | undefined {
  const onTheDay = new Set<number>();
  const movedForWeekend = new Set<number>();
  for (const date of scheduled) {
    const day = Math.floor(date.getTime() / MS_PER_DAY);
    onTheDay.add(day);
    if (date.getUTCDay() === SATURDAY) movedForWeekend.add(day - 1).add(day + 2);
    if (date.getUTCDay() === SUNDAY) movedForWeekend.add(day - 2).add(day + 1);
  }
  let moves = 0;
  for (const day of observedDays) {
    if (onTheDay.has(day)) continue;
    if (!movedForWeekend.has(day)) return undefined;
    moves += 1;
  }
  return moves;
}

function inferType(amountCents: number, frequency: RecurringFrequency): RecurringType {
  if (amountCents > 0) return "PAYCHECK";
  if (Math.abs(amountCents) <= SUBSCRIPTION_MAX_CENTS) return "SUBSCRIPTION";
  void frequency;
  return "BILL";
}

function confidenceFor(count: number, frequency: RecurringFrequency): number {
  if (frequency === "IRREGULAR") return 40;
  return Math.min(95, 55 + count * 10); // 2→75, 3→85, 4+→95
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
