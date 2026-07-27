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
import { projectNextExpected } from "./schedule";

/** Minimum matching transactions before a merchant is treated as recurring. */
export const MIN_OCCURRENCES_FOR_RECURRING = 2;
/** A recurring outflow at or below this magnitude is treated as a subscription, else a bill. */
export const SUBSCRIPTION_MAX_CENTS = 5000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  const frequency = inferFrequency(gaps);

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
    nextExpectedDate: projectNextExpected(latest.transactionDate, frequency, ctx.asOf),
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
