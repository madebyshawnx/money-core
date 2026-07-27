/**
 * Transaction inbox — a derived view over transaction state (not a service).
 *
 * The docs model the inbox as a UI route backed by the ledger/rule layer
 * (Phase-4 contract §8: "inbox is a derived view, not a documented service").
 * It surfaces everything that needs a human decision: NEEDS_REVIEW items,
 * duplicate/transfer candidates, and low-confidence classifications
 * (docs/10: "Low-confidence items enter inbox"; docs/33: needs-review is
 * "grouped by category, confidence, and reason").
 *
 * Ordering is deterministic (reason priority, then most-recent first, then id),
 * matching the pure/deterministic contract of the rest of the engine.
 */

import type { Rule, Transaction, TransactionState } from "@/lib/domain/types";
import { ruleMatches } from "./match";

/** Confidence strictly below this puts an otherwise-settled transaction in the inbox. */
export const INBOX_LOW_CONFIDENCE_THRESHOLD = 50;

export type InboxReason =
  | "NEEDS_REVIEW"
  | "DUPLICATE_CANDIDATE"
  | "TRANSFER_CANDIDATE"
  | "LOW_CONFIDENCE";

export interface InboxItem {
  transaction: Transaction;
  reason: InboxReason;
}

const REASON_PRIORITY: Record<InboxReason, number> = {
  NEEDS_REVIEW: 0,
  DUPLICATE_CANDIDATE: 1,
  TRANSFER_CANDIDATE: 2,
  LOW_CONFIDENCE: 3,
};

/** States that carry their own inbox reason directly. */
const STATE_REASON: Partial<Record<TransactionState, InboxReason>> = {
  NEEDS_REVIEW: "NEEDS_REVIEW",
  DUPLICATE_CANDIDATE: "DUPLICATE_CANDIDATE",
  TRANSFER_CANDIDATE: "TRANSFER_CANDIDATE",
};

/** A resolved/terminal row is never shown, even if its confidence is low. */
const RESOLVED_STATES: ReadonlySet<TransactionState> = new Set([
  "REMOVED",
  "USER_CONFIRMED",
  "EXCLUDED",
  "TRANSFER_CONFIRMED",
  "DUPLICATE_CONFIRMED",
]);

function reasonFor(t: Transaction): InboxReason | undefined {
  const byState = STATE_REASON[t.state];
  if (byState) return byState;
  if (RESOLVED_STATES.has(t.state)) return undefined;
  if (t.confidenceScore < INBOX_LOW_CONFIDENCE_THRESHOLD) return "LOW_CONFIDENCE";
  return undefined;
}

/** Build the deterministically-ordered inbox from a set of transactions. */
export function selectInbox(transactions: Transaction[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const t of transactions) {
    const reason = reasonFor(t);
    if (reason) items.push({ transaction: t, reason });
  }
  return items.sort((a, b) => {
    const byReason = REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason];
    if (byReason !== 0) return byReason;
    const byDate = b.transaction.transactionDate.getTime() - a.transaction.transactionDate.getTime();
    if (byDate !== 0) return byDate;
    return a.transaction.id < b.transaction.id ? -1 : a.transaction.id > b.transaction.id ? 1 : 0;
  });
}

/** SUGGESTED rules that would match a transaction — proposed to the user, never auto-applied. */
export function matchingSuggestedRules(rules: Rule[], txn: Transaction): Rule[] {
  return rules.filter((r) => r.status === "SUGGESTED" && ruleMatches(r, txn));
}
