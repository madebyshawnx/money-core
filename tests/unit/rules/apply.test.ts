import { describe, it, expect } from "vitest";
import type { Rule, Transaction } from "@/lib/domain/types";
import {
  applyRule,
  classifyTransaction,
  classifyTransactions,
  AUTO_APPLY_CONFIDENCE_THRESHOLD,
  type ApplyContext,
} from "@/lib/domain/rules/apply";

const ctx: ApplyContext = { appliedAt: new Date("2026-07-11T12:00:00.000Z") };

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_1",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    amountCents: -6721,
    currencyCode: "USD",
    merchantNormalized: "Trader Joe's",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 70,
    tagIds: [],
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule_1",
    householdId: "hh_1",
    name: "r",
    status: "ACTIVE",
    conditions: [{ merchantContains: "Trader Joe's" }],
    actions: { setCategoryId: "cat_groceries" },
    confidenceScore: 88,
    ...overrides,
  };
}

describe("rules apply — applyRule", () => {
  it("sets the category and auto-classifies when rule confidence ≥ threshold", () => {
    const r = rule({ confidenceScore: AUTO_APPLY_CONFIDENCE_THRESHOLD });
    const { transaction } = applyRule(r, txn(), ctx);
    expect(transaction.categoryId).toBe("cat_groceries");
    expect(transaction.state).toBe("AUTO_CLASSIFIED");
  });

  it("routes categorization to review when rule confidence < threshold", () => {
    const r = rule({ confidenceScore: AUTO_APPLY_CONFIDENCE_THRESHOLD - 1 });
    const { transaction } = applyRule(r, txn(), ctx);
    expect(transaction.categoryId).toBe("cat_groceries");
    expect(transaction.state).toBe("NEEDS_REVIEW");
  });

  it("setExcluded sets the spending flag without forcing the user-gated EXCLUDED state", () => {
    const r = rule({ actions: { setExcluded: true } });
    const { transaction } = applyRule(r, txn(), ctx);
    expect(transaction.isExcludedFromSpending).toBe(true);
    expect(transaction.state).not.toBe("EXCLUDED");
  });

  it("setTransfer moves the transaction to TRANSFER_CANDIDATE (never auto-confirmed)", () => {
    const r = rule({ actions: { setTransfer: true } });
    const { transaction } = applyRule(r, txn(), ctx);
    expect(transaction.state).toBe("TRANSFER_CANDIDATE");
  });

  it("requireReview routes to NEEDS_REVIEW and takes precedence over categorization", () => {
    const r = rule({ actions: { setCategoryId: "cat_groceries", requireReview: true } });
    const { transaction } = applyRule(r, txn(), ctx);
    expect(transaction.state).toBe("NEEDS_REVIEW");
  });

  it("addTagId appends without duplicating an existing tag", () => {
    const r = rule({ actions: { addTagId: "tag_a" } });
    const first = applyRule(r, txn(), ctx).transaction;
    expect(first.tagIds).toEqual(["tag_a"]);
    const second = applyRule(r, first, ctx).transaction;
    expect(second.tagIds).toEqual(["tag_a"]);
  });

  it("produces a RuleApplication record and does not mutate the input", () => {
    const input = txn();
    const { application } = applyRule(rule(), input, ctx);
    expect(application.ruleId).toBe("rule_1");
    expect(application.transactionId).toBe("txn_1");
    expect(application.appliedAt).toEqual(ctx.appliedAt);
    expect(application.undoneAt).toBeUndefined();
    expect(input.categoryId).toBeUndefined();
    expect(input.state).toBe("POSTED");
  });
});

describe("rules apply — classifyTransaction", () => {
  it("applies only the first matching ACTIVE rule (first-match precedence)", () => {
    const first = rule({ id: "first", actions: { setCategoryId: "cat_first" } });
    const second = rule({ id: "second", actions: { setCategoryId: "cat_second" } });
    const { transaction, applications } = classifyTransaction([first, second], txn(), ctx);
    expect(transaction.categoryId).toBe("cat_first");
    expect(applications.map((a) => a.ruleId)).toEqual(["first"]);
  });

  it("skips transactions already resolved by the user", () => {
    const { transaction, applications } = classifyTransaction(
      [rule()],
      txn({ state: "USER_CONFIRMED" }),
      ctx,
    );
    expect(transaction.state).toBe("USER_CONFIRMED");
    expect(applications).toHaveLength(0);
  });

  it("leaves the transaction unchanged when no rule matches", () => {
    const r = rule({ conditions: [{ merchantContains: "Nope" }] });
    const { transaction, applications } = classifyTransaction([r], txn(), ctx);
    expect(transaction).toEqual(txn());
    expect(applications).toHaveLength(0);
  });

  it("classifies a batch and collects every application", () => {
    const out = classifyTransactions(
      [rule()],
      [txn({ id: "a" }), txn({ id: "b" }), txn({ id: "c", merchantNormalized: "Nope" })],
      ctx,
    );
    expect(out.transactions).toHaveLength(3);
    expect(out.applications.map((a) => a.transactionId).sort()).toEqual(["a", "b"]);
  });
});
