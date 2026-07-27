import { describe, it, expect } from "vitest";
import type { Rule, RuleCondition, Transaction } from "@/lib/domain/types";
import { conditionMatches, ruleMatches, matchingActiveRules } from "@/lib/domain/rules/match";

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    amountCents: -6721,
    currencyCode: "USD",
    merchantRaw: "TRADER JOE'S #451",
    merchantNormalized: "Trader Joe's",
    descriptionRaw: "POS PURCHASE",
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
    name: "Trader Joe's → Groceries",
    status: "ACTIVE",
    conditions: [{ merchantContains: "Trader Joe's" }],
    actions: { setCategoryId: "cat_groceries" },
    confidenceScore: 88,
    ...overrides,
  };
}

describe("rules match — conditionMatches", () => {
  it("matches a case-sensitive merchant substring against the normalized merchant", () => {
    expect(conditionMatches({ merchantContains: "Trader Joe's" }, txn())).toBe(true);
  });

  it("falls back to the raw merchant when normalized is absent", () => {
    expect(
      conditionMatches({ merchantContains: "TRADER JOE" }, txn({ merchantNormalized: undefined })),
    ).toBe(true);
  });

  it("is case-sensitive (does not match a different case)", () => {
    expect(conditionMatches({ merchantContains: "trader joe's" }, txn())).toBe(false);
  });

  it("AND-s multiple present fields within one condition", () => {
    const cond: RuleCondition = { merchantContains: "Trader Joe's", amountEqualsCents: -6721 };
    expect(conditionMatches(cond, txn())).toBe(true);
    expect(conditionMatches({ ...cond, amountEqualsCents: -1 }, txn())).toBe(false);
  });

  it("matches on accountId and descriptionContains", () => {
    expect(conditionMatches({ accountId: "acct_1" }, txn())).toBe(true);
    expect(conditionMatches({ descriptionContains: "POS" }, txn())).toBe(true);
    expect(conditionMatches({ accountId: "other" }, txn())).toBe(false);
  });

  it("does not match an empty condition (no testable fields)", () => {
    expect(conditionMatches({}, txn())).toBe(false);
  });

  it("does not match an unsupported transactionType-only condition", () => {
    expect(conditionMatches({ transactionType: "debit" }, txn())).toBe(false);
  });
});

describe("rules match — ruleMatches (OR across conditions)", () => {
  it("matches when ANY condition matches", () => {
    const r = rule({ conditions: [{ merchantContains: "Nope" }, { accountId: "acct_1" }] });
    expect(ruleMatches(r, txn())).toBe(true);
  });

  it("does not match when NO condition matches", () => {
    const r = rule({ conditions: [{ merchantContains: "Nope" }, { accountId: "other" }] });
    expect(ruleMatches(r, txn())).toBe(false);
  });

  it("does not match a rule with no conditions", () => {
    expect(ruleMatches(rule({ conditions: [] }), txn())).toBe(false);
  });
});

describe("rules match — matchingActiveRules", () => {
  it("returns only ACTIVE rules that match, preserving input order", () => {
    const active = rule({ id: "a", status: "ACTIVE" });
    const suggested = rule({ id: "s", status: "SUGGESTED" });
    const paused = rule({ id: "p", status: "PAUSED" });
    const out = matchingActiveRules([suggested, active, paused], txn());
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
});
