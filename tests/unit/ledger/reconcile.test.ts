import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/domain/types";
import type {
  ProviderTransactionDto,
  TransactionSyncResult,
} from "@/lib/providers/financial-data/types";
import { reconcileSync } from "@/lib/domain/ledger/reconcile";
import { makeTransactionId, type NormalizationContext } from "@/lib/domain/ledger/normalize";
import { summarize } from "@/lib/domain/ledger/metrics";

const ctx: NormalizationContext = {
  householdId: "hh_1",
  resolveAccountId: () => "acct_1",
};

function dto(overrides: Partial<ProviderTransactionDto> = {}): ProviderTransactionDto {
  return {
    providerTransactionId: "p1",
    providerAccountId: "prov-acct-1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    amountCents: -4200,
    currencyCode: "USD",
    merchantName: "Osteria Verde",
    isPending: false,
    ...overrides,
  };
}

function sync(overrides: Partial<TransactionSyncResult> = {}): TransactionSyncResult {
  return { added: [], modified: [], removed: [], hasMore: false, ...overrides };
}

describe("ledger reconcile — applying a sync result", () => {
  it("inserts an added transaction as a canonical row", () => {
    const result = reconcileSync([], sync({ added: [dto()] }), ctx);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.id).toBe(makeTransactionId("p1"));
    expect(result.transactions[0]!.state).toBe("POSTED");
    expect(result.addedCount).toBe(1);
  });

  it("is idempotent: re-applying the same added DTO does not duplicate the row", () => {
    const first = reconcileSync([], sync({ added: [dto()] }), ctx);
    const second = reconcileSync(first.transactions, sync({ added: [dto()] }), ctx);
    expect(second.transactions).toHaveLength(1);
    expect(second.addedCount).toBe(0);
    expect(second.modifiedCount).toBe(1);
  });

  it("upserts a modified transaction in place (pending amount corrected)", () => {
    const start = reconcileSync([], sync({ added: [dto({ isPending: true, amountCents: -4200 })] }), ctx);
    const updated = reconcileSync(
      start.transactions,
      sync({ modified: [dto({ isPending: true, amountCents: -4500 })] }),
      ctx,
    );
    expect(updated.transactions).toHaveLength(1);
    expect(updated.transactions[0]!.amountCents).toBe(-4500);
    expect(updated.modifiedCount).toBe(1);
  });

  it("marks a removed provider transaction id as REMOVED", () => {
    const start = reconcileSync([], sync({ added: [dto()] }), ctx);
    const removed = reconcileSync(start.transactions, sync({ removed: ["p1"] }), ctx, {
      occurredAt: new Date("2026-07-07T00:00:00.000Z"),
    });
    const row = removed.transactions[0]!;
    expect(row.state).toBe("REMOVED");
    expect(row.isPending).toBe(false);
    expect(row.removedAt).toEqual(new Date("2026-07-07T00:00:00.000Z"));
    expect(removed.removedCount).toBe(1);
  });

  it("ignores a removed id that is not in the ledger (idempotent)", () => {
    const result = reconcileSync([], sync({ removed: ["ghost"] }), ctx);
    expect(result.transactions).toHaveLength(0);
    expect(result.removedCount).toBe(0);
  });

  it("links a pending charge to its posted replacement without double-counting", () => {
    // Seed a pending hold, then post it with a tip via providerPendingTransactionId.
    const start = reconcileSync(
      [],
      sync({ added: [dto({ providerTransactionId: "pending", isPending: true, amountCents: -4200 })] }),
      ctx,
    );
    const posted = reconcileSync(
      start.transactions,
      sync({
        added: [
          dto({
            providerTransactionId: "posted",
            providerPendingTransactionId: "pending",
            isPending: false,
            amountCents: -4956,
          }),
        ],
      }),
      ctx,
    );

    const pendingRow = posted.transactions.find((t) => t.id === makeTransactionId("pending"))!;
    const postedRow = posted.transactions.find((t) => t.id === makeTransactionId("posted"))!;
    expect(pendingRow.replacementTransactionId).toBe(postedRow.id);
    // Only the posted charge counts toward spending — never the sum.
    expect(summarize(posted.transactions).totalSpendingCents).toBe(4956);
  });

  it("does not mutate the input ledger array or its rows", () => {
    const start = reconcileSync([], sync({ added: [dto()] }), ctx);
    const snapshot: Transaction[] = start.transactions.map((t) => ({ ...t }));
    reconcileSync(start.transactions, sync({ removed: ["p1"] }), ctx);
    expect(start.transactions).toEqual(snapshot);
  });
});

describe("ledger reconcile — re-ingest preserves reconciliation and user metadata", () => {
  it("keeps replacementTransactionId when the superseded pending DTO is re-sent", () => {
    // Pending hold, then posted replacement (link established)…
    const start = reconcileSync(
      [],
      sync({ added: [dto({ providerTransactionId: "pending", isPending: true, amountCents: -4200 })] }),
      ctx,
    );
    const posted = reconcileSync(
      start.transactions,
      sync({
        added: [
          dto({
            providerTransactionId: "posted",
            providerPendingTransactionId: "pending",
            isPending: false,
            amountCents: -4956,
          }),
        ],
      }),
      ctx,
    );
    // …then the provider re-sends the original pending DTO in a later batch.
    const replayed = reconcileSync(
      posted.transactions,
      sync({ modified: [dto({ providerTransactionId: "pending", isPending: true, amountCents: -4200 })] }),
      ctx,
    );

    const pendingRow = replayed.transactions.find((t) => t.id === makeTransactionId("pending"))!;
    expect(pendingRow.replacementTransactionId).toBe(makeTransactionId("posted"));
    // The pending hold must stay superseded — only the posted charge counts.
    expect(summarize(replayed.transactions).totalSpendingCents).toBe(4956);
  });

  it("keeps user classification and review state when the provider re-sends a modified DTO", () => {
    const start = reconcileSync([], sync({ added: [dto()] }), ctx);
    const userWorked: Transaction[] = start.transactions.map((t) => ({
      ...t,
      state: "USER_CONFIRMED",
      categoryId: "cat_dining",
      tagIds: ["tag_datenight"],
      isExcludedFromSpending: true,
      isForecastRelevant: true,
    }));

    const replayed = reconcileSync(
      userWorked,
      sync({ modified: [dto({ merchantName: "OSTERIA VERDE 022" })] }),
      ctx,
    );

    const row = replayed.transactions[0]!;
    expect(row.merchantRaw).toBe("OSTERIA VERDE 022"); // provider-owned field updates
    expect(row.state).toBe("USER_CONFIRMED"); // user decisions survive
    expect(row.categoryId).toBe("cat_dining");
    expect(row.tagIds).toEqual(["tag_datenight"]);
    expect(row.isExcludedFromSpending).toBe(true);
    expect(row.isForecastRelevant).toBe(true);
  });

  it("still advances PENDING to POSTED when the provider settles a merged row", () => {
    const start = reconcileSync(
      [],
      sync({ added: [dto({ isPending: true, amountCents: -4200 })] }),
      ctx,
    );
    const settled = reconcileSync(
      start.transactions,
      sync({ modified: [dto({ isPending: false, amountCents: -4200 })] }),
      ctx,
    );
    const row = settled.transactions[0]!;
    expect(row.state).toBe("POSTED");
    expect(row.isPending).toBe(false);
  });

  it("replaying a removal is idempotent: no re-count, removedAt preserved", () => {
    const start = reconcileSync([], sync({ added: [dto()] }), ctx);
    const removed = reconcileSync(start.transactions, sync({ removed: ["p1"] }), ctx, {
      occurredAt: new Date("2026-07-07T00:00:00.000Z"),
    });
    // Same removal replayed later, this time without a timestamp.
    const replayed = reconcileSync(removed.transactions, sync({ removed: ["p1"] }), ctx);

    const row = replayed.transactions[0]!;
    expect(row.state).toBe("REMOVED");
    expect(row.removedAt).toEqual(new Date("2026-07-07T00:00:00.000Z"));
    expect(replayed.removedCount).toBe(0);
  });
});
