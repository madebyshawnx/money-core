import { describe, it, expect } from "vitest";
import type { Rule, Transaction } from "@/lib/domain/types";
import {
  selectInbox,
  matchingSuggestedRules,
  INBOX_LOW_CONFIDENCE_THRESHOLD,
} from "@/lib/domain/rules/inbox";

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    amountCents: -1000,
    currencyCode: "USD",
    merchantNormalized: "Store",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
    ...overrides,
  };
}

describe("rules inbox — selectInbox", () => {
  it("surfaces NEEDS_REVIEW, DUPLICATE_CANDIDATE and TRANSFER_CANDIDATE with a reason", () => {
    const items = selectInbox([
      txn({ id: "r", state: "NEEDS_REVIEW", confidenceScore: 48 }),
      txn({ id: "d", state: "DUPLICATE_CANDIDATE", confidenceScore: 40 }),
      txn({ id: "x", state: "TRANSFER_CANDIDATE", confidenceScore: 50 }),
    ]);
    const byId = Object.fromEntries(items.map((i) => [i.transaction.id, i.reason]));
    expect(byId["r"]).toBe("NEEDS_REVIEW");
    expect(byId["d"]).toBe("DUPLICATE_CANDIDATE");
    expect(byId["x"]).toBe("TRANSFER_CANDIDATE");
  });

  it("surfaces a low-confidence posted transaction as LOW_CONFIDENCE", () => {
    const items = selectInbox([txn({ id: "low", confidenceScore: INBOX_LOW_CONFIDENCE_THRESHOLD - 1 })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.reason).toBe("LOW_CONFIDENCE");
  });

  it("excludes settled, high-confidence, removed and user-resolved transactions", () => {
    const items = selectInbox([
      txn({ id: "clean", confidenceScore: 95 }),
      txn({ id: "removed", state: "REMOVED", confidenceScore: 10 }),
      txn({ id: "confirmed", state: "USER_CONFIRMED", confidenceScore: 10 }),
    ]);
    expect(items).toHaveLength(0);
  });

  it("orders items by reason priority then most-recent first (deterministic)", () => {
    const items = selectInbox([
      txn({ id: "xfer", state: "TRANSFER_CANDIDATE", transactionDate: new Date("2026-07-01") }),
      txn({ id: "review_old", state: "NEEDS_REVIEW", transactionDate: new Date("2026-07-02") }),
      txn({ id: "review_new", state: "NEEDS_REVIEW", transactionDate: new Date("2026-07-09") }),
    ]);
    expect(items.map((i) => i.transaction.id)).toEqual(["review_new", "review_old", "xfer"]);
  });
});

describe("rules inbox — matchingSuggestedRules", () => {
  function rule(overrides: Partial<Rule> = {}): Rule {
    return {
      id: "rule_1",
      householdId: "hh_1",
      name: "Store → Shopping",
      status: "SUGGESTED",
      conditions: [{ merchantContains: "Store" }],
      actions: { setCategoryId: "cat_shopping" },
      confidenceScore: 80,
      ...overrides,
    };
  }

  it("returns SUGGESTED rules that match the transaction", () => {
    expect(matchingSuggestedRules([rule()], txn()).map((r) => r.id)).toEqual(["rule_1"]);
  });

  it("excludes ACTIVE rules (those auto-apply, they are not suggestions)", () => {
    expect(matchingSuggestedRules([rule({ status: "ACTIVE" })], txn())).toHaveLength(0);
  });

  it("excludes SUGGESTED rules that do not match", () => {
    expect(matchingSuggestedRules([rule({ conditions: [{ merchantContains: "Nope" }] })], txn())).toHaveLength(0);
  });
});
