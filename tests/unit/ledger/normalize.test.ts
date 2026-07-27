import { describe, it, expect } from "vitest";
import type { ProviderTransactionDto } from "@/lib/providers/financial-data/types";
import {
  normalizeTransaction,
  normalizeTransactions,
  makeTransactionId,
  UnknownAccountError,
  type NormalizationContext,
} from "@/lib/domain/ledger/normalize";

const ctx: NormalizationContext = {
  householdId: "hh_1",
  resolveAccountId: (providerAccountId) =>
    providerAccountId === "prov-acct-1" ? "acct_1" : undefined,
};

function dto(overrides: Partial<ProviderTransactionDto> = {}): ProviderTransactionDto {
  return {
    providerTransactionId: "prov-txn-1",
    providerAccountId: "prov-acct-1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    postedAt: new Date("2026-07-06T00:00:00.000Z"),
    amountCents: -4200,
    currencyCode: "USD",
    merchantName: "Osteria Verde",
    description: "CARD PURCHASE",
    isPending: false,
    ...overrides,
  };
}

describe("ledger normalize — DTO → canonical Transaction", () => {
  it("maps provider fields onto the canonical transaction", () => {
    const t = normalizeTransaction(dto(), ctx);
    expect(t.householdId).toBe("hh_1");
    expect(t.accountId).toBe("acct_1");
    expect(t.providerTransactionId).toBe("prov-txn-1");
    expect(t.amountCents).toBe(-4200);
    expect(t.currencyCode).toBe("USD");
    expect(t.merchantRaw).toBe("Osteria Verde");
    expect(t.descriptionRaw).toBe("CARD PURCHASE");
    expect(t.transactionDate).toEqual(new Date("2026-07-05T00:00:00.000Z"));
    expect(t.postedAt).toEqual(new Date("2026-07-06T00:00:00.000Z"));
  });

  it("derives POSTED state for a settled DTO", () => {
    const t = normalizeTransaction(dto({ isPending: false }), ctx);
    expect(t.state).toBe("POSTED");
    expect(t.isPending).toBe(false);
  });

  it("derives PENDING state for a pending DTO", () => {
    const t = normalizeTransaction(dto({ isPending: true, postedAt: undefined }), ctx);
    expect(t.state).toBe("PENDING");
    expect(t.isPending).toBe(true);
  });

  it("derives REMOVED state (never pending) for a removed DTO", () => {
    const t = normalizeTransaction(dto({ isRemoved: true, isPending: true }), ctx);
    expect(t.state).toBe("REMOVED");
    expect(t.isPending).toBe(false);
  });

  it("starts unclassified: no category, no detection groups, empty tags", () => {
    const t = normalizeTransaction(dto(), ctx);
    expect(t.categoryId).toBeUndefined();
    expect(t.duplicateGroupId).toBeUndefined();
    expect(t.transferGroupId).toBeUndefined();
    expect(t.replacementTransactionId).toBeUndefined();
    expect(t.tagIds).toEqual([]);
  });

  it("derives a deterministic id from the provider transaction id", () => {
    expect(makeTransactionId("prov-txn-1")).toBe(makeTransactionId("prov-txn-1"));
    expect(normalizeTransaction(dto(), ctx).id).toBe(makeTransactionId("prov-txn-1"));
  });

  it("throws UnknownAccountError when the provider account cannot be resolved", () => {
    expect(() => normalizeTransaction(dto({ providerAccountId: "nope" }), ctx)).toThrow(
      UnknownAccountError,
    );
  });

  it("normalizes an array preserving order", () => {
    const ts = normalizeTransactions(
      [dto({ providerTransactionId: "a" }), dto({ providerTransactionId: "b" })],
      ctx,
    );
    expect(ts.map((t) => t.providerTransactionId)).toEqual(["a", "b"]);
  });
});

describe("normalization — amount validation at the provider boundary", () => {
  it("rejects a non-integer amountCents", () => {
    expect(() => normalizeTransaction(dto({ amountCents: 12.34 }), ctx)).toThrow(/integer/i);
  });
});
