/**
 * Recurring obligations — public surface.
 *
 * `RecurringService` is the immutable facade over the Phase-5 engine, mirroring
 * `LedgerService` / `RuleService`. It holds a set of obligations and exposes
 * deterministic detection (from transaction history), current-cycle status
 * matching, and the confirmed/active/forecast-flagged subset the cash-flow
 * forecast (Phase 6) will consume.
 */

import type { RecurringObligation, Transaction } from "@/lib/domain/types";
import { detectRecurring, type DetectContext } from "./detect";
import { matchObligations, type MatchContext, type ObligationStatusResult } from "./match";

export * from "./schedule";
export * from "./detect";
export * from "./match";

export class RecurringService {
  constructor(private readonly obligations: RecurringObligation[] = []) {}

  /** The obligations backing this service. */
  get all(): readonly RecurringObligation[] {
    return this.obligations;
  }

  /** Infer candidate recurring obligations from transaction history (unconfirmed). */
  detect(transactions: Transaction[], ctx: DetectContext): RecurringObligation[] {
    return detectRecurring(transactions, ctx);
  }

  /** Current-cycle status (PAID/DUE/OVERDUE/UPCOMING/INACTIVE) for each obligation. */
  matchAll(transactions: Transaction[], ctx: MatchContext): ObligationStatusResult[] {
    return matchObligations(this.obligations, transactions, ctx);
  }

  /** Obligations eligible to drive the cash-flow forecast: confirmed, active, flagged. */
  forForecast(): RecurringObligation[] {
    return this.obligations.filter((o) => o.isConfirmed && o.isActive && o.includeInForecast);
  }
}
