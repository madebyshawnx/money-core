import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/domain/types";
import {
  summarize,
  spendingByCategory,
  UNCATEGORIZED,
} from "@/lib/domain/ledger/metrics";
import { getPrimaryDataset } from "@/lib/seed/scenarios";

/** Minimal canonical transaction; POSTED outflow by default. */
function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-01T00:00:00.000Z"),
    amountCents: -1000,
    currencyCode: "USD",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
    ...overrides,
  };
}

describe("ledger metrics — spending inclusion/exclusion policy", () => {
  it("counts a posted outflow toward spending, not income", () => {
    const s = summarize([txn({ id: "a", amountCents: -2500 })]);
    expect(s.totalSpendingCents).toBe(2500);
    expect(s.totalIncomeCents).toBe(0);
  });

  it("counts a positive amount as income and never as spending (e.g. a paycheck)", () => {
    // Paychecks are flagged isExcludedFromSpending but are still income.
    const s = summarize([
      txn({ id: "pay", amountCents: 412000, isExcludedFromSpending: true }),
    ]);
    expect(s.totalIncomeCents).toBe(412000);
    expect(s.totalSpendingCents).toBe(0);
  });

  it("excludes an isExcludedFromSpending outflow from the spending total", () => {
    const s = summarize([txn({ id: "x", amountCents: -5000, isExcludedFromSpending: true })]);
    expect(s.totalSpendingCents).toBe(0);
  });

  it("excludes transfers (candidate and confirmed) from spending and income", () => {
    const s = summarize([
      txn({ id: "out", amountCents: -30000, state: "TRANSFER_CONFIRMED" }),
      txn({ id: "in", amountCents: 30000, state: "TRANSFER_CANDIDATE" }),
    ]);
    expect(s.totalSpendingCents).toBe(0);
    expect(s.totalIncomeCents).toBe(0);
  });

  it("excludes a REMOVED transaction from every total", () => {
    const s = summarize([txn({ id: "r", amountCents: -9999, state: "REMOVED" })]);
    expect(s.totalSpendingCents).toBe(0);
    expect(s.netCashFlowCents).toBe(0);
  });

  it("does not double-count a pending charge that has been replaced by its posting", () => {
    const pending = txn({
      id: "pending",
      amountCents: -4200,
      state: "PENDING",
      isPending: true,
      replacementTransactionId: "posted",
    });
    const posted = txn({ id: "posted", amountCents: -4956, state: "POSTED" });
    const s = summarize([pending, posted]);
    // Only the posted charge (with tip) counts.
    expect(s.totalSpendingCents).toBe(4956);
  });

  it("counts a duplicate group only once, preferring the non-pending member", () => {
    const hold = txn({
      id: "hold",
      amountCents: -28900,
      state: "DUPLICATE_CANDIDATE",
      isPending: true,
      duplicateGroupId: "g",
    });
    const charge = txn({
      id: "charge",
      amountCents: -28900,
      state: "DUPLICATE_CANDIDATE",
      isPending: false,
      duplicateGroupId: "g",
    });
    const s = summarize([hold, charge]);
    expect(s.totalSpendingCents).toBe(28900);
  });

  it("computes net cash flow as income minus spending (signed)", () => {
    const s = summarize([
      txn({ id: "pay", amountCents: 100000, isExcludedFromSpending: true }),
      txn({ id: "buy", amountCents: -30000 }),
    ]);
    expect(s.netCashFlowCents).toBe(70000);
  });

  it("reports the ids of transactions counted as income (for evidence)", () => {
    const s = summarize([
      txn({ id: "pay", amountCents: 100000, isExcludedFromSpending: true }),
      txn({ id: "buy", amountCents: -30000 }),
    ]);
    expect(s.countedIncomeIds).toEqual(["pay"]);
  });

  it("filters by transaction date when a period is supplied (inclusive bounds)", () => {
    const inWindow = txn({ id: "in", amountCents: -1000, transactionDate: new Date("2026-07-05") });
    const before = txn({ id: "b", amountCents: -1000, transactionDate: new Date("2026-06-01") });
    const s = summarize([inWindow, before], {
      start: new Date("2026-07-01"),
      end: new Date("2026-07-31"),
    });
    expect(s.totalSpendingCents).toBe(1000);
  });
});

describe("ledger metrics — spendingByCategory", () => {
  it("groups counted outflows by category and buckets missing categories as uncategorized", () => {
    const byCat = spendingByCategory([
      txn({ id: "g1", amountCents: -1000, categoryId: "cat_groceries" }),
      txn({ id: "g2", amountCents: -1500, categoryId: "cat_groceries" }),
      txn({ id: "u", amountCents: -700, categoryId: undefined }),
      txn({ id: "pay", amountCents: 5000, categoryId: "cat_income" }), // income, not spend
    ]);
    expect(byCat["cat_groceries"]).toBe(2500);
    expect(byCat[UNCATEGORIZED]).toBe(700);
    expect(byCat["cat_income"]).toBeUndefined();
  });
});

describe("ledger metrics — anchored to seed scenarios", () => {
  const { transactions } = getPrimaryDataset();

  it("excludes the replaced Osteria Verde pending hold but counts the posted charge", () => {
    const s = summarize(transactions);
    const pending = transactions.find((t) => t.id === "txn_rivera_dining_pending")!;
    const posted = transactions.find((t) => t.id === "txn_rivera_dining_posted")!;
    expect(pending.replacementTransactionId).toBe("txn_rivera_dining_posted");
    // The posted magnitude is counted; the superseded pending is not — so removing
    // both would drop spending by exactly the posted amount, never the sum.
    const withoutDining = summarize(
      transactions.filter((t) => t.id !== "txn_rivera_dining_pending" && t.id !== posted.id),
    );
    expect(s.totalSpendingCents - withoutDining.totalSpendingCents).toBe(Math.abs(posted.amountCents));
  });

  it("does not count the unresolved Venmo reimbursement candidate as income", () => {
    const s = summarize(transactions);
    const venmo = transactions.find((t) => t.id === "txn_rivera_venmo_1")!;
    expect(venmo.transferGroupId).toBe("grp_rivera_venmo");
    const withoutVenmo = summarize(transactions.filter((t) => t.id !== venmo.id));
    expect(s.totalIncomeCents).toBe(withoutVenmo.totalIncomeCents);
  });
});

describe("metrics — user exclusion and duplicate groups across periods", () => {
  it("does not count a user-EXCLUDED inflow as income", () => {
    const inflow = txn({
      id: "t_refund",
      amountCents: 5000,
      state: "EXCLUDED",
      isExcludedFromSpending: true,
    });
    const summary = summarize([inflow]);
    expect(summary.totalIncomeCents).toBe(0);
    expect(summary.countedIncomeIds).toEqual([]);
  });

  it("still counts a paycheck (excluded from spending only) as income", () => {
    const paycheck = txn({
      id: "t_pay",
      amountCents: 300000,
      state: "POSTED",
      isExcludedFromSpending: true,
    });
    expect(summarize([paycheck]).totalIncomeCents).toBe(300000);
  });

  it("counts a duplicate group once across adjacent comparison windows", () => {
    const jan = txn({
      id: "t_jan31",
      transactionDate: new Date("2026-01-31T00:00:00.000Z"),
      amountCents: -500,
      duplicateGroupId: "dup_x",
    });
    const feb = txn({
      id: "t_feb01",
      transactionDate: new Date("2026-02-01T00:00:00.000Z"),
      amountCents: -500,
      duplicateGroupId: "dup_x",
    });
    const janWindow = {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-01-31T23:59:59.999Z"),
    };
    const febWindow = {
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-02-28T23:59:59.999Z"),
    };
    const janSpend = summarize([jan, feb], janWindow).totalSpendingCents;
    const febSpend = summarize([jan, feb], febWindow).totalSpendingCents;
    const combined = summarize([jan, feb]).totalSpendingCents;
    expect(janSpend + febSpend).toBe(combined);
  });
});
