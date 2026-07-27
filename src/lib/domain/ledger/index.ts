/**
 * Canonical ledger — public surface.
 *
 * `LedgerService` is the immutable facade over the Phase-3 engine (docs/06
 * "Recommended services: LedgerService, TransactionStateService"). It threads a
 * normalization context and an immutable transaction array through the pure
 * stages — normalize → reconcile → detect (ingest) and the guarded state machine
 * (transition) — and exposes deterministic derived views (summary,
 * spendingByCategory). Every mutating method returns a NEW service instance; the
 * receiver is never modified.
 */

import type { Transaction, TransactionState } from "@/lib/domain/types";
import type { TransactionSyncResult } from "@/lib/providers/financial-data/types";
import { applyTransition, type TransitionActor } from "./state-machine";
import { detectAll } from "./detect";
import { reconcileSync, type ReconcileOptions } from "./reconcile";
import { summarize, spendingByCategory, type LedgerPeriod, type SpendingSummary } from "./metrics";
import { type NormalizationContext } from "./normalize";

export * from "./state-machine";
export * from "./normalize";
export * from "./reconcile";
export * from "./detect";
export * from "./metrics";

export class LedgerService {
  constructor(
    private readonly ctx: NormalizationContext,
    readonly transactions: readonly Transaction[] = [],
  ) {}

  /** Apply a provider sync batch, then re-run duplicate/transfer detection. */
  ingestSync(sync: TransactionSyncResult, options?: ReconcileOptions): LedgerService {
    const { transactions } = reconcileSync([...this.transactions], sync, this.ctx, options);
    return new LedgerService(this.ctx, detectAll(transactions));
  }

  /** Move a single transaction to a new state via the guarded state machine. */
  transition(transactionId: string, to: TransactionState, actor: TransitionActor): LedgerService {
    let found = false;
    const next = this.transactions.map((t) => {
      if (t.id !== transactionId) return t;
      found = true;
      return applyTransition(t, to, actor);
    });
    if (!found) throw new Error(`Transaction not found: ${transactionId}`);
    return new LedgerService(this.ctx, next);
  }

  get(transactionId: string): Transaction | undefined {
    return this.transactions.find((t) => t.id === transactionId);
  }

  summary(period?: LedgerPeriod): SpendingSummary {
    return summarize([...this.transactions], period);
  }

  spendingByCategory(period?: LedgerPeriod): Record<string, number> {
    return spendingByCategory([...this.transactions], period);
  }
}
