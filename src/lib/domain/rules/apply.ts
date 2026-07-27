/**
 * Rule application and classification.
 *
 * "High-confidence rules auto-apply. Low-confidence items enter inbox." (docs/10
 * Phase-3 acceptance). The numeric threshold is NOT SPECIFIED (Phase-4 contract
 * §3), so it is a named, documented constant here.
 *
 * Design decisions (docs silent — see contract §2/§3/§7):
 *   - Only ACTIVE rules apply (matchingActiveRules); SUGGESTED rules are proposed
 *     to the user, never auto-applied (docs/02: "Rules require user approval
 *     before being applied broadly in V1").
 *   - First matching ACTIVE rule wins (deterministic first-match precedence).
 *   - Rule actions run with SYSTEM authority. `setExcluded` therefore sets the
 *     `isExcludedFromSpending` FLAG rather than forcing the USER-gated EXCLUDED
 *     state; `setTransfer` proposes TRANSFER_CANDIDATE (only a user confirms).
 *   - Every application produces a `RuleApplication` row (docs/17: "Rule
 *     application creates audit events and rule application rows").
 *
 * Pure and deterministic: no clock is read — the caller supplies `appliedAt`.
 */

import type { Rule, RuleApplication, Transaction, TransactionState } from "@/lib/domain/types";
import { applyTransition, canTransition } from "@/lib/domain/ledger/state-machine";
import { matchingActiveRules } from "./match";

/** A rule scoring at or above this auto-applies (AUTO_CLASSIFIED); below it routes to review. */
export const AUTO_APPLY_CONFIDENCE_THRESHOLD = 85;

/** Transaction states that are already resolved and must not be re-classified by rules. */
const RESOLVED_STATES: ReadonlySet<TransactionState> = new Set([
  "REMOVED",
  "USER_CONFIRMED",
  "EXCLUDED",
  "TRANSFER_CONFIRMED",
  "DUPLICATE_CONFIRMED",
]);

export interface ApplyContext {
  /** Timestamp stamped on the RuleApplication (deterministic — no clock read here). */
  appliedAt: Date;
  /** Optional deterministic id factory for RuleApplication rows. */
  makeApplicationId?: (ruleId: string, transactionId: string) => string;
}

export interface RuleApplicationOutcome {
  transaction: Transaction;
  application: RuleApplication;
}

export interface ClassifyOutcome {
  transaction: Transaction;
  applications: RuleApplication[];
}

export interface ClassifyManyOutcome {
  transactions: Transaction[];
  applications: RuleApplication[];
}

function applicationId(ctx: ApplyContext, ruleId: string, transactionId: string): string {
  return ctx.makeApplicationId?.(ruleId, transactionId) ?? `rapp_${ruleId}_${transactionId}`;
}

/** Apply a single rule's actions to a transaction, returning the new row + an application record. */
export function applyRule(rule: Rule, transaction: Transaction, ctx: ApplyContext): RuleApplicationOutcome {
  const { actions } = rule;
  let next: Transaction = transaction;

  if (actions.setCategoryId !== undefined) {
    next = { ...next, categoryId: actions.setCategoryId };
  }
  if (actions.addTagId !== undefined && !next.tagIds.includes(actions.addTagId)) {
    next = { ...next, tagIds: [...next.tagIds, actions.addTagId] };
  }
  if (actions.setExcluded === true) {
    next = { ...next, isExcludedFromSpending: true };
  }

  const targetState = resolveTargetState(rule, next);
  if (targetState && canTransition(next.state, targetState, "SYSTEM")) {
    next = applyTransition(next, targetState, "SYSTEM");
  }

  const application: RuleApplication = {
    id: applicationId(ctx, rule.id, transaction.id),
    ruleId: rule.id,
    transactionId: transaction.id,
    appliedAt: ctx.appliedAt,
  };
  return { transaction: next, application };
}

/** Decide which state (if any) a rule's actions drive the transaction into. */
function resolveTargetState(rule: Rule, txn: Transaction): TransactionState | undefined {
  const { actions } = rule;
  if (actions.requireReview === true) return "NEEDS_REVIEW";
  if (actions.setTransfer === true) return "TRANSFER_CANDIDATE";
  if (actions.setCategoryId !== undefined) {
    return rule.confidenceScore >= AUTO_APPLY_CONFIDENCE_THRESHOLD ? "AUTO_CLASSIFIED" : "NEEDS_REVIEW";
  }
  void txn;
  return undefined;
}

/** Apply the first matching ACTIVE rule to a transaction (no-op for already-resolved rows). */
export function classifyTransaction(rules: Rule[], transaction: Transaction, ctx: ApplyContext): ClassifyOutcome {
  if (RESOLVED_STATES.has(transaction.state)) {
    return { transaction, applications: [] };
  }
  const match = matchingActiveRules(rules, transaction)[0];
  if (!match) return { transaction, applications: [] };
  const { transaction: next, application } = applyRule(match, transaction, ctx);
  return { transaction: next, applications: [application] };
}

/** Classify a batch of transactions, collecting every RuleApplication produced. */
export function classifyTransactions(rules: Rule[], transactions: Transaction[], ctx: ApplyContext): ClassifyManyOutcome {
  const outTransactions: Transaction[] = [];
  const applications: RuleApplication[] = [];
  for (const t of transactions) {
    const outcome = classifyTransaction(rules, t, ctx);
    outTransactions.push(outcome.transaction);
    applications.push(...outcome.applications);
  }
  return { transactions: outTransactions, applications };
}
