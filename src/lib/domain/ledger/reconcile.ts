/**
 * Sync reconciliation — apply a provider `TransactionSyncResult` to the ledger.
 *
 * This is the release-blocking core: "Pending/posting transitions do not
 * double-count" (docs/10 Phase-2 acceptance; docs/17 lists double-counting as a
 * release blocker). Reconciliation is idempotent — re-applying the same sync
 * result leaves the ledger in the same state — because every canonical row is
 * keyed by a deterministic id derived from its provider transaction id.
 *
 * Rules:
 *   - added / modified DTOs are UPSERTED by canonical id (re-ingest is safe).
 *     Provider data is raw input, not truth: an upsert onto an EXISTING row
 *     updates only the provider-owned fields (dates, amount, currency, merchant,
 *     description, pending flag) and never resets classification, review state,
 *     exclusion flags, or reconciliation links the provider knows nothing about.
 *   - settlement still advances on merge (PENDING → POSTED when the DTO posts),
 *     but a provider replay can never move a row backwards or un-remove it.
 *   - a posted DTO carrying `providerPendingTransactionId` links the existing
 *     pending row via `replacementTransactionId`; the pending row keeps its
 *     PENDING state and is excluded from spend by the metrics layer, so only the
 *     posted charge counts (no double count).
 *   - removed provider ids flip the matching row to REMOVED (unknown ids are
 *     ignored and already-REMOVED rows are left untouched, keeping the operation
 *     idempotent — a replayed removal is not re-counted and keeps its removedAt).
 *
 * Pure and immutable: inputs are never mutated; a fresh transaction array is
 * returned. No clock is read — a caller may pass `occurredAt` to stamp removals.
 */

import type { Transaction } from "@/lib/domain/types";
import type { TransactionSyncResult } from "@/lib/providers/financial-data/types";
import { makeTransactionId, normalizeTransaction, type NormalizationContext } from "./normalize";

export interface ReconcileOptions {
  /** Timestamp stamped on rows flipped to REMOVED. Omitted → removedAt stays undefined. */
  occurredAt?: Date;
}

export interface ReconcileResult {
  transactions: Transaction[];
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

export function reconcileSync(
  existing: Transaction[],
  sync: TransactionSyncResult,
  ctx: NormalizationContext,
  options: ReconcileOptions = {},
): ReconcileResult {
  const ledger = new Map<string, Transaction>(existing.map((t) => [t.id, t]));
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  for (const dto of [...sync.added, ...sync.modified]) {
    const normalized = normalizeTransaction(dto, ctx);
    const current = ledger.get(normalized.id);
    if (current) {
      modifiedCount += 1;
      ledger.set(normalized.id, mergeProviderFields(current, normalized));
    } else {
      addedCount += 1;
      ledger.set(normalized.id, normalized);
    }

    // Pending → posted replacement: link the superseded pending row.
    if (dto.providerPendingTransactionId != null) {
      const pendingId = makeTransactionId(dto.providerPendingTransactionId);
      const pendingRow = ledger.get(pendingId);
      if (pendingRow) {
        ledger.set(pendingId, { ...pendingRow, replacementTransactionId: normalized.id });
      }
    }
  }

  for (const providerTransactionId of sync.removed) {
    const id = makeTransactionId(providerTransactionId);
    const row = ledger.get(id);
    if (!row || row.state === "REMOVED") continue;
    removedCount += 1;
    ledger.set(id, {
      ...row,
      state: "REMOVED",
      isPending: false,
      removedAt: options.occurredAt,
    });
  }

  return {
    transactions: [...ledger.values()],
    addedCount,
    modifiedCount,
    removedCount,
  };
}

/**
 * Merge a re-normalized provider DTO onto an existing canonical row.
 *
 * The provider owns the raw facts of the charge; everything else on the row —
 * classification (categoryId, tagIds, confidenceScore), review state, exclusion
 * and forecast flags, and reconciliation links (replacementTransactionId,
 * duplicate/transfer groups, removedAt) — was produced by later pipeline stages
 * or the user, and a sync replay must never erase it.
 */
function mergeProviderFields(current: Transaction, normalized: Transaction): Transaction {
  return {
    ...current,
    transactionDate: normalized.transactionDate,
    postedAt: normalized.postedAt,
    amountCents: normalized.amountCents,
    currencyCode: normalized.currencyCode,
    merchantRaw: normalized.merchantRaw,
    descriptionRaw: normalized.descriptionRaw,
    isPending: normalized.isPending,
    state: nextStateOnMerge(current.state, normalized.state),
  };
}

/** Settlement may advance (PENDING → POSTED) or terminate (→ REMOVED); a replay never regresses a row. */
function nextStateOnMerge(
  currentState: Transaction["state"],
  normalizedState: Transaction["state"],
): Transaction["state"] {
  if (currentState === "REMOVED") return "REMOVED";
  if (normalizedState === "REMOVED") return "REMOVED";
  if (currentState === "PENDING" && normalizedState === "POSTED") return "POSTED";
  return currentState;
}
