/**
 * Obligation matching — is this cycle's bill/paycheck paid, due, or overdue?
 *
 * Backs the bills screen (docs/02: "what's due, what's paid, what's overdue").
 * The docs do not define matching tolerances or the due window (NOT SPECIFIED),
 * so they are named constants here.
 *
 * A transaction settles an obligation's expected occurrence when it shares the
 * normalized merchant, sits within an amount tolerance, and posts within a few
 * days of the expected date. Pure/deterministic: caller supplies `asOf`.
 */

import type { RecurringObligation, Transaction } from "@/lib/domain/types";

/** How close (in days) a transaction must post to the expected date to settle it. */
export const MATCH_WINDOW_DAYS = 5;
/** How far ahead (in days) an unpaid expected occurrence is considered DUE vs UPCOMING. */
export const DUE_WINDOW_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ObligationStatus = "PAID" | "DUE" | "OVERDUE" | "UPCOMING" | "INACTIVE" | "UNKNOWN";

export interface ObligationStatusResult {
  obligation: RecurringObligation;
  status: ObligationStatus;
  expectedDate?: Date;
  matchedTransactionId?: string;
}

export interface MatchContext {
  asOf: Date;
  dueWindowDays?: number;
  matchWindowDays?: number;
}

function amountWithinTolerance(a: number, b: number): boolean {
  const tolerance = Math.max(500, Math.abs(b) * 0.15);
  return Math.abs(a - b) <= tolerance;
}

function findSettlingTransaction(
  obligation: RecurringObligation,
  transactions: Transaction[],
  expectedDate: Date,
  matchWindowDays: number,
): Transaction | undefined {
  const windowMs = matchWindowDays * MS_PER_DAY;
  const amount = obligation.amountCents;
  return transactions.find(
    (t) =>
      t.state !== "REMOVED" &&
      t.merchantNormalized === obligation.merchantNormalized &&
      amount !== undefined &&
      amountWithinTolerance(t.amountCents, amount) &&
      Math.abs(t.transactionDate.getTime() - expectedDate.getTime()) <= windowMs,
  );
}

function fallbackStatus(
  obligation: RecurringObligation,
  expectedDate: Date,
  ctx: MatchContext,
): ObligationStatus {
  const dueWindowMs = (ctx.dueWindowDays ?? DUE_WINDOW_DAYS) * MS_PER_DAY;
  const expectedMs = expectedDate.getTime();
  const asOfMs = ctx.asOf.getTime();
  if (expectedMs < asOfMs) return "OVERDUE";
  if (expectedMs <= asOfMs + dueWindowMs) return "DUE";
  return "UPCOMING";
}

/** Determine the current-cycle status of a single obligation. */
export function statusOf(
  obligation: RecurringObligation,
  transactions: Transaction[],
  ctx: MatchContext,
): ObligationStatusResult {
  if (!obligation.isActive) {
    return { obligation, status: "INACTIVE" };
  }
  const expectedDate = obligation.nextExpectedDate;
  if (!expectedDate) {
    return { obligation, status: "UNKNOWN" };
  }

  const matchWindowDays = ctx.matchWindowDays ?? MATCH_WINDOW_DAYS;
  const settled = findSettlingTransaction(obligation, transactions, expectedDate, matchWindowDays);
  if (settled) {
    return { obligation, status: "PAID", expectedDate, matchedTransactionId: settled.id };
  }

  return { obligation, status: fallbackStatus(obligation, expectedDate, ctx), expectedDate };
}

/** Status for each obligation, preserving input order. */
export function matchObligations(
  obligations: RecurringObligation[],
  transactions: Transaction[],
  ctx: MatchContext,
): ObligationStatusResult[] {
  const matchWindowDays = ctx.matchWindowDays ?? MATCH_WINDOW_DAYS;
  const results = obligations.map((obligation): ObligationStatusResult => {
    if (!obligation.isActive) return { obligation, status: "INACTIVE" };
    const expectedDate = obligation.nextExpectedDate;
    if (!expectedDate) return { obligation, status: "UNKNOWN" };
    return { obligation, status: fallbackStatus(obligation, expectedDate, ctx), expectedDate };
  });

  const candidates = obligations.flatMap((obligation, obligationIndex) => {
    const expectedDate = obligation.nextExpectedDate;
    if (!obligation.isActive || !expectedDate) return [];
    return transactions
      .filter((transaction) => findSettlingTransaction(obligation, [transaction], expectedDate, matchWindowDays) !== undefined)
      .map((transaction) => ({
        obligationIndex,
        obligationId: obligation.id,
        transaction,
        distanceMs: Math.abs(transaction.transactionDate.getTime() - expectedDate.getTime()),
      }));
  });

  const allocatedTransactionIds = new Set<string>();
  const settledObligationIndexes = new Set<number>();
  for (const candidate of candidates.sort(byBestAllocation)) {
    if (allocatedTransactionIds.has(candidate.transaction.id) || settledObligationIndexes.has(candidate.obligationIndex)) continue;
    allocatedTransactionIds.add(candidate.transaction.id);
    settledObligationIndexes.add(candidate.obligationIndex);
    results[candidate.obligationIndex] = {
      obligation: obligations[candidate.obligationIndex]!,
      status: "PAID",
      expectedDate: obligations[candidate.obligationIndex]!.nextExpectedDate,
      matchedTransactionId: candidate.transaction.id,
    };
  }

  return results;
}

function byBestAllocation(
  a: { obligationId: string; transaction: Transaction; distanceMs: number },
  b: { obligationId: string; transaction: Transaction; distanceMs: number },
): number {
  if (a.distanceMs !== b.distanceMs) return a.distanceMs - b.distanceMs;
  if (a.obligationId !== b.obligationId) return a.obligationId < b.obligationId ? -1 : 1;
  return a.transaction.id < b.transaction.id ? -1 : a.transaction.id > b.transaction.id ? 1 : 0;
}
