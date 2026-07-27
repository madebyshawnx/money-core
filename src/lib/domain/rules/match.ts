/**
 * Rule condition matching.
 *
 * "Rules can match merchant, amount, account, transaction type, cadence, and
 * description" (docs/02). The docs do not define the boolean semantics
 * (Phase-4 contract §1: within-condition AND/OR, across-conditions AND/OR, and
 * case-sensitivity are all NOT SPECIFIED), so the semantics below are designed
 * to the seed fixture and documented here:
 *
 *   - Within a single `RuleCondition`, all PRESENT fields must match (AND).
 *   - Across a rule's `conditions[]`, ANY condition matching is a match (OR).
 *   - `merchantContains` / `descriptionContains` are case-sensitive substring
 *     tests. Merchant is tested against `merchantNormalized ?? merchantRaw`
 *     (the seed "Trader Joe's" rule matches the normalized merchant, not the
 *     uppercased raw one).
 *   - `transactionType` has no canonical Transaction field, so a condition that
 *     specifies it cannot be evaluated and does not match (documented gap).
 *   - An empty condition (no testable fields) does not match.
 *
 * Pure and deterministic.
 */

import type { Rule, RuleCondition, Transaction } from "@/lib/domain/types";

/** True when every present, supported field on `condition` matches `txn`. */
export function conditionMatches(condition: RuleCondition, txn: Transaction): boolean {
  // transactionType is unsupported (no canonical field) — refuse rather than over-match.
  if (condition.transactionType !== undefined) return false;

  const checks: boolean[] = [];

  if (condition.merchantContains !== undefined) {
    const merchant = txn.merchantNormalized ?? txn.merchantRaw ?? "";
    checks.push(merchant.includes(condition.merchantContains));
  }
  if (condition.descriptionContains !== undefined) {
    checks.push((txn.descriptionRaw ?? "").includes(condition.descriptionContains));
  }
  if (condition.amountEqualsCents !== undefined) {
    checks.push(txn.amountCents === condition.amountEqualsCents);
  }
  if (condition.accountId !== undefined) {
    checks.push(txn.accountId === condition.accountId);
  }

  // No testable field present → not a match.
  if (checks.length === 0) return false;
  return checks.every(Boolean);
}

/** True when ANY of the rule's conditions matches `txn` (rule must have ≥1 condition). */
export function ruleMatches(rule: Rule, txn: Transaction): boolean {
  return rule.conditions.some((c) => conditionMatches(c, txn));
}

/** ACTIVE rules that match `txn`, in input order (deterministic precedence). */
export function matchingActiveRules(rules: Rule[], txn: Transaction): Rule[] {
  return rules.filter((r) => r.status === "ACTIVE" && ruleMatches(r, txn));
}
