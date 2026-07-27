/**
 * Transaction state machine.
 *
 * Cadence keeps settlement lifecycle, review status, and detection status
 * in a single `TransactionState` enum (docs/07 §"Transaction state design":
 * "Do not collapse these into a single boolean"). This module is the one place
 * that decides which state changes are legal and who is allowed to make them.
 *
 * The docs do not hand us a transition table (see the Phase-3 contract:
 * "Legal transition table / explicitly illegal transitions: NOT SPECIFIED"), so
 * this table is designed to the per-state semantics in docs/16 §"Internal
 * transaction states": settlement is SYSTEM-driven (from the provider feed),
 * candidate→confirmed is USER-gated, REMOVED is terminal.
 *
 * All functions are pure and deterministic — no clock, no randomness. Callers
 * that need to stamp `postedAt` / `removedAt` do so from provider DTO dates in
 * the reconciliation layer, not here.
 */

import type { Transaction, TransactionState } from "@/lib/domain/types";

/** Who is requesting a transition. Detection/sync are SYSTEM; inbox actions are USER. */
export type TransitionActor = "SYSTEM" | "USER";

/** Which actor(s) may perform a given transition. */
type AllowedActor = TransitionActor | "ANY";

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: TransactionState,
    readonly to: TransactionState,
    readonly actor: TransitionActor,
  ) {
    super(`Illegal transition ${from} → ${to} by ${actor}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * from → (to → allowed actor). A missing entry means the transition is illegal.
 * REMOVED is terminal (empty map). Candidate→confirmed transitions are USER-only.
 */
export const TRANSITIONS: Record<TransactionState, Partial<Record<TransactionState, AllowedActor>>> = {
  PENDING: {
    POSTED: "SYSTEM",
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "SYSTEM",
    AUTO_CLASSIFIED: "SYSTEM",
    TRANSFER_CANDIDATE: "SYSTEM",
    DUPLICATE_CANDIDATE: "SYSTEM",
    EXCLUDED: "USER",
  },
  POSTED: {
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "SYSTEM",
    AUTO_CLASSIFIED: "SYSTEM",
    TRANSFER_CANDIDATE: "SYSTEM",
    DUPLICATE_CANDIDATE: "SYSTEM",
    USER_CONFIRMED: "USER",
    EXCLUDED: "USER",
  },
  NEEDS_REVIEW: {
    AUTO_CLASSIFIED: "SYSTEM",
    TRANSFER_CANDIDATE: "SYSTEM",
    DUPLICATE_CANDIDATE: "SYSTEM",
    POSTED: "SYSTEM",
    REMOVED: "SYSTEM",
    USER_CONFIRMED: "USER",
    EXCLUDED: "USER",
    TRANSFER_CONFIRMED: "USER",
    DUPLICATE_CONFIRMED: "USER",
  },
  AUTO_CLASSIFIED: {
    REMOVED: "SYSTEM",
    TRANSFER_CANDIDATE: "SYSTEM",
    DUPLICATE_CANDIDATE: "SYSTEM",
    USER_CONFIRMED: "USER",
    NEEDS_REVIEW: "USER",
    EXCLUDED: "USER",
  },
  USER_CONFIRMED: {
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "USER",
    EXCLUDED: "USER",
  },
  EXCLUDED: {
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "USER",
    USER_CONFIRMED: "USER",
  },
  TRANSFER_CANDIDATE: {
    REMOVED: "SYSTEM",
    TRANSFER_CONFIRMED: "USER",
    USER_CONFIRMED: "USER",
    NEEDS_REVIEW: "USER",
    EXCLUDED: "USER",
  },
  TRANSFER_CONFIRMED: {
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "USER",
    USER_CONFIRMED: "USER",
  },
  DUPLICATE_CANDIDATE: {
    REMOVED: "SYSTEM",
    DUPLICATE_CONFIRMED: "USER",
    POSTED: "USER",
    USER_CONFIRMED: "USER",
    NEEDS_REVIEW: "USER",
    EXCLUDED: "USER",
  },
  DUPLICATE_CONFIRMED: {
    REMOVED: "SYSTEM",
    NEEDS_REVIEW: "USER",
  },
  REMOVED: {},
};

/** True when `actor` may move a transaction from `from` to `to`. */
export function canTransition(
  from: TransactionState,
  to: TransactionState,
  actor: TransitionActor,
): boolean {
  const allowed = TRANSITIONS[from][to];
  if (allowed === undefined) return false;
  return allowed === "ANY" || allowed === actor;
}

/**
 * Return a NEW transaction in state `to`, applying deterministic flag updates
 * implied by the target state. Throws `IllegalTransitionError` if the transition
 * is not permitted for `actor`. The input transaction is never mutated.
 */
export function applyTransition(
  transaction: Transaction,
  to: TransactionState,
  actor: TransitionActor,
): Transaction {
  if (!canTransition(transaction.state, to, actor)) {
    throw new IllegalTransitionError(transaction.state, to, actor);
  }
  return {
    ...transaction,
    state: to,
    isPending: derivePending(to, transaction.isPending),
    isExcludedFromSpending: deriveExcluded(to, transaction.isExcludedFromSpending),
    duplicateGroupId: deriveDuplicateGroup(transaction, to),
    transferGroupId: deriveTransferGroup(transaction, to),
  };
}

function derivePending(to: TransactionState, current: boolean): boolean {
  if (to === "PENDING") return true;
  if (to === "POSTED" || to === "REMOVED") return false;
  return current;
}

function deriveExcluded(to: TransactionState, current: boolean): boolean {
  // Confirming a transfer or explicitly excluding removes the txn from spend.
  if (to === "EXCLUDED" || to === "TRANSFER_CONFIRMED") return true;
  // USER_CONFIRMED means "this is real countable activity" — it is the
  // un-exclude path (EXCLUDED → USER_CONFIRMED) and the not-a-transfer path
  // (TRANSFER_CANDIDATE/TRANSFER_CONFIRMED → USER_CONFIRMED).
  if (to === "USER_CONFIRMED") return false;
  return current;
}

/** Dismissing a duplicate candidate as real activity dissolves its group link. */
function deriveDuplicateGroup(t: Transaction, to: TransactionState): string | undefined {
  if (t.state === "DUPLICATE_CANDIDATE" && (to === "POSTED" || to === "USER_CONFIRMED")) {
    return undefined;
  }
  return t.duplicateGroupId;
}

/** Confirming a transfer candidate as real activity dissolves its pair link. */
function deriveTransferGroup(t: Transaction, to: TransactionState): string | undefined {
  if (t.state === "TRANSFER_CANDIDATE" && to === "USER_CONFIRMED") {
    return undefined;
  }
  return t.transferGroupId;
}
