/**
 * Cash-flow forecast — public surface.
 *
 * `ForecastService` is the immutable facade over the Phase-6 engine, mirroring
 * the other domain services. It holds the household's accounts, forecast-eligible
 * obligations (typically `RecurringService.forForecast()`), and ledger
 * transactions, and produces a deterministic `ForecastRun` for a given window.
 */

import type { FinancialAccount, ForecastRun, RecurringObligation, Transaction } from "@/lib/domain/types";
import { buildForecast } from "./forecast";

export * from "./forecast";

export interface ForecastBuildOptions {
  makeRunId?: () => string;
}

export class ForecastService {
  constructor(
    private readonly accounts: FinancialAccount[] = [],
    private readonly obligations: RecurringObligation[] = [],
    private readonly transactions: Transaction[] = [],
  ) {}

  /** Build a deterministic cash-flow forecast for the [periodStart, periodEnd] window. */
  build(periodStart: Date, periodEnd: Date, options: ForecastBuildOptions = {}): ForecastRun {
    return buildForecast({
      householdId: this.accounts[0]?.householdId ?? this.obligations[0]?.householdId ?? "",
      accounts: this.accounts,
      obligations: this.obligations,
      transactions: this.transactions,
      periodStart,
      periodEnd,
      makeRunId: options.makeRunId,
    });
  }
}
