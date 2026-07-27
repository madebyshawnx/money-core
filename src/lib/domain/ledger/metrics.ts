/**
 * Derived ledger metrics — pure, deterministic views over canonical transactions.
 *
 * The docs mandate deterministic fact calculation (docs/08: "Deterministic
 * services calculate facts") but do NOT give closed-form formulas. What they DO
 * pin down is the inclusion/exclusion policy for "spending" (Phase-3 contract §7,
 * docs/16 §"Internal transaction states", docs/10 Phase-4 acceptance). This
 * module encodes that policy in one place so every downstream fact (briefing,
 * forecast, comparisons) counts money the same way.
 *
 * Sign convention (lib/domain/types.ts): negative = outflow/spend, positive =
 * inflow. Totals returned here are POSITIVE magnitudes; net cash flow is signed
 * (positive = net inflow).
 *
 * A transaction counts toward SPENDING iff ALL of:
 *   - it is an outflow (amountCents < 0)
 *   - not isExcludedFromSpending (this flag also excludes income like paychecks)
 *   - not a transfer (see isTransfer)
 *   - not REMOVED
 *   - not a superseded pending (replacementTransactionId set)
 *   - not a confirmed duplicate, and only ONE member of any duplicate group counts
 * Income mirrors this for inflows, but ignores isExcludedFromSpending (a paycheck
 * is excluded from spend yet is still income).
 */

import type { Cents } from "@/lib/utils/money";
import type { Transaction } from "@/lib/domain/types";

/** Sentinel category key for counted spend with no category assigned. */
export const UNCATEGORIZED = "__uncategorized__";

/** Inclusive-bounds date window filtered on `transactionDate`. */
export interface LedgerPeriod {
  start: Date;
  end: Date;
}

export interface SpendingSummary {
  /** Total outflow that counts as spending, as a positive magnitude. */
  totalSpendingCents: Cents;
  /** Total inflow that counts as income, as a positive magnitude. */
  totalIncomeCents: Cents;
  /** Income minus spending. Positive = net inflow. */
  netCashFlowCents: Cents;
  /** Ids of the transactions that counted toward spending (evidence/debugging). */
  countedSpendingIds: string[];
  /** Ids of the transactions that counted toward income (evidence/debugging). */
  countedIncomeIds: string[];
}

// ---------------------------------------------------------------------------
// Eligibility predicates
// ---------------------------------------------------------------------------

/**
 * A transfer is money moving between the household's own accounts and never
 * counts as spending or income. Confirmed/candidate states are authoritative; an
 * unresolved `transferGroupId` (e.g. a reimbursement routed to the inbox as
 * NEEDS_REVIEW) is treated as a transfer until the user resolves it as real
 * activity (USER_CONFIRMED) or excludes it.
 */
function isTransfer(t: Transaction): boolean {
  if (t.state === "TRANSFER_CANDIDATE" || t.state === "TRANSFER_CONFIRMED") return true;
  if (t.state === "USER_CONFIRMED" || t.state === "EXCLUDED") return false;
  return t.transferGroupId != null;
}

/** True when a PENDING row has already been superseded by its POSTED counterpart. */
function isSupersededPending(t: Transaction): boolean {
  return t.replacementTransactionId != null;
}

/** Shared base eligibility for both spending and income (before duplicate dedup). */
function isLedgerEligible(t: Transaction): boolean {
  return (
    t.state !== "REMOVED" &&
    t.state !== "DUPLICATE_CONFIRMED" &&
    !isSupersededPending(t) &&
    !isTransfer(t)
  );
}

function isInPeriod(t: Transaction, period?: LedgerPeriod): boolean {
  if (!period) return true;
  const ms = t.transactionDate.getTime();
  return ms >= period.start.getTime() && ms <= period.end.getTime();
}

/**
 * Collapse duplicate groups so at most one member survives. The representative
 * prefers a non-pending (settled) row, then the lowest id for determinism.
 * Non-grouped transactions pass through untouched.
 */
function dedupeDuplicateGroups(transactions: Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>();
  const singles: Transaction[] = [];
  for (const t of transactions) {
    if (t.duplicateGroupId == null) {
      singles.push(t);
      continue;
    }
    const bucket = groups.get(t.duplicateGroupId);
    if (bucket) bucket.push(t);
    else groups.set(t.duplicateGroupId, [t]);
  }
  const representatives = [...groups.values()].map((members) =>
    [...members].sort((a, b) => {
      if (a.isPending !== b.isPending) return a.isPending ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })[0],
  );
  return [...singles, ...representatives].filter((t): t is Transaction => t !== undefined);
}

// ---------------------------------------------------------------------------
// Public metric functions
// ---------------------------------------------------------------------------

/**
 * The deduped set of transactions eligible to count as spending. Duplicate
 * groups are collapsed over the FULL ledger before the period filter so a group
 * straddling two comparison windows has one global representative — never one
 * per window (which would double-count it across adjacent periods).
 */
function countedSpending(transactions: Transaction[], period?: LedgerPeriod): Transaction[] {
  const eligible = transactions.filter(
    (t) => isLedgerEligible(t) && t.amountCents < 0 && !t.isExcludedFromSpending,
  );
  return dedupeDuplicateGroups(eligible).filter((t) => isInPeriod(t, period));
}

/**
 * The deduped set of transactions eligible to count as income. A row the user
 * moved to EXCLUDED counts as neither spending nor income; the spending-only
 * `isExcludedFromSpending` flag alone (e.g. a paycheck) still counts as income.
 */
function countedIncome(transactions: Transaction[], period?: LedgerPeriod): Transaction[] {
  const eligible = transactions.filter(
    (t) => isLedgerEligible(t) && t.amountCents > 0 && t.state !== "EXCLUDED",
  );
  return dedupeDuplicateGroups(eligible).filter((t) => isInPeriod(t, period));
}

export function summarize(transactions: Transaction[], period?: LedgerPeriod): SpendingSummary {
  const spending = countedSpending(transactions, period);
  const income = countedIncome(transactions, period);
  const totalSpendingCents = spending.reduce((acc, t) => acc + Math.abs(t.amountCents), 0);
  const totalIncomeCents = income.reduce((acc, t) => acc + t.amountCents, 0);
  return {
    totalSpendingCents,
    totalIncomeCents,
    netCashFlowCents: totalIncomeCents - totalSpendingCents,
    countedSpendingIds: spending.map((t) => t.id),
    countedIncomeIds: income.map((t) => t.id),
  };
}

/** Positive spend magnitude grouped by categoryId; uncategorized under `UNCATEGORIZED`. */
export function spendingByCategory(
  transactions: Transaction[],
  period?: LedgerPeriod,
): Record<string, Cents> {
  const result: Record<string, Cents> = {};
  for (const t of countedSpending(transactions, period)) {
    const key = t.categoryId ?? UNCATEGORIZED;
    result[key] = (result[key] ?? 0) + Math.abs(t.amountCents);
  }
  return result;
}
