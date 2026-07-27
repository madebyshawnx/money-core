/**
 * Cash-flow forecast — deterministic projection of the household's cash runway.
 *
 * docs/06 promises "deterministic 30-day cash-flow projections"; docs/02 WF4:
 * the forecast starts from current available balances, then "adds expected income
 * and known transfers" and "subtracts recurring bills and pending transactions".
 * Exact formulas are NOT SPECIFIED, so the composition rules are fixed here.
 *
 * Design decisions (documented; docs silent):
 *   - Starting balance = available balance of connected LIQUID accounts
 *     (CHECKING/SAVINGS/CASH). Credit-card balances are debt, not cash runway,
 *     so they are excluded from the start point (their payments still appear as
 *     recurring outflows).
 *   - Line items come from (a) each recurring occurrence in the window
 *     (RecurringService.forForecast() feeds this) and (b) forecast-relevant
 *     pending transactions within the window.
 *   - The projected low balance is the minimum of the running balance across the
 *     window (starting point included); it is the cushion.
 *   - Confidence is the minimum line-item confidence (most-uncertain drives it).
 *
 * Pure and deterministic: no clock, no RNG. Money is integer cents; negative =
 * outflow.
 */

import type {
  FinancialAccount,
  ForecastLineItem,
  ForecastLineItemSource,
  ForecastRun,
  RecurringObligation,
  RecurringType,
  Transaction,
} from "@/lib/domain/types";
import type { Cents } from "@/lib/utils/money";
import { formatCents } from "@/lib/utils/money";
import { occurrencesBetween } from "@/lib/domain/recurring/schedule";

/** Below this projected low balance (but ≥ 0) the forecast flags a thin cushion. */
export const LOW_CUSHION_THRESHOLD_CENTS = 20000; // $200.00

/** Account types that hold spendable cash and seed the forecast's starting balance. */
const LIQUID_TYPES: ReadonlySet<FinancialAccount["type"]> = new Set(["CHECKING", "SAVINGS", "CASH"]);
const DEFAULT_OBLIGATION_MATCH_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ForecastInput {
  householdId: string;
  accounts: FinancialAccount[];
  /** Obligations to project — typically RecurringService.forForecast(). */
  obligations: RecurringObligation[];
  /** Ledger transactions; forecast-relevant pending rows become line items. */
  transactions: Transaction[];
  periodStart: Date;
  periodEnd: Date;
  makeRunId?: () => string;
}

export function buildForecast(input: ForecastInput): ForecastRun {
  const balanceCoverage = cashFlowBalanceCoverage(input.accounts);
  const startingBalanceCents = startingBalance(input.accounts);
  const lineItems = buildLineItems(input).sort(byDateThenLabel);

  const projection = balanceCoverage.isComplete
    ? projectLowBalance(startingBalanceCents, input.periodStart, lineItems)
    : undefined;
  const warnings = buildWarnings(projection?.lowCents, projection?.lowDate, balanceCoverage);
  const confidenceScore = lineItems.length
    ? Math.min(...lineItems.map((l) => l.confidenceScore))
    : 100;

  return {
    id: input.makeRunId?.() ?? `forecast_${input.householdId}_${input.periodStart.toISOString()}`,
    householdId: input.householdId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    startingBalanceCents,
    balanceCoverage,
    projectedLowBalanceCents: projection?.lowCents,
    projectedLowDate: projection?.lowDate,
    cushionCents: projection?.lowCents,
    lineItems,
    warnings,
    confidenceScore,
  };
}

function cashFlowBalanceCoverage(accounts: FinancialAccount[]): NonNullable<ForecastRun["balanceCoverage"]> {
  const included = accounts.filter((a) => LIQUID_TYPES.has(a.type) && a.includeInForecast && !a.isDisconnected);
  const recorded = included.filter((a) => a.lastBalanceAvailableCents !== undefined || a.lastBalanceCents !== undefined);
  return {
    recordedCount: recorded.length,
    totalCount: included.length,
    missingCount: included.length - recorded.length,
    isComplete: recorded.length === included.length,
  };
}

function startingBalance(accounts: FinancialAccount[]): Cents {
  return accounts
    .filter((a) => LIQUID_TYPES.has(a.type) && a.includeInForecast && !a.isDisconnected)
    .reduce((acc, a) => acc + (a.lastBalanceAvailableCents ?? a.lastBalanceCents ?? 0), 0);
}

function buildLineItems(input: ForecastInput): ForecastLineItem[] {
  const items: ForecastLineItem[] = [];
  const forecastTransactions = input.transactions.filter(
    (t) =>
      t.isForecastRelevant &&
      (t.state === "PENDING" || t.state === "POSTED") &&
      t.transactionDate >= input.periodStart &&
      t.transactionDate <= input.periodEnd,
  );

  for (const ob of input.obligations) {
    if (!ob.isActive || ob.amountCents === undefined || !ob.nextExpectedDate) continue;
    const dates = occurrencesBetween(ob.nextExpectedDate, ob.frequency, input.periodStart, input.periodEnd);
    for (const date of dates) {
      if (forecastTransactions.some((t) => transactionMatchesOccurrence(t, ob, date))) continue;
      items.push({
        date,
        label: ob.name,
        amountCents: ob.amountCents,
        source: sourceForType(ob.type),
        confidenceScore: ob.confidenceScore,
        evidenceId: ob.id,
      });
    }
  }

  for (const t of input.transactions) {
    if (!t.isForecastRelevant) continue;
    if (t.transactionDate < input.periodStart || t.transactionDate > input.periodEnd) continue;
    items.push({
      date: t.transactionDate,
      label: t.merchantNormalized ?? t.merchantRaw ?? "Pending transaction",
      amountCents: t.amountCents,
      source: "PENDING_TRANSACTION",
      confidenceScore: t.confidenceScore,
      evidenceId: t.id,
    });
  }

  return items;
}

interface ForecastMatchSettings {
  matchAmountToleranceCents?: number;
  matchWindowDays?: number;
}

function transactionMatchesOccurrence(transaction: Transaction, obligation: RecurringObligation, occurrenceDate: Date): boolean {
  if (obligation.accountId !== undefined && transaction.accountId !== obligation.accountId) return false;
  if (obligation.amountCents === undefined) return false;

  const settings = obligation as RecurringObligation & ForecastMatchSettings;
  const amountTolerance = settings.matchAmountToleranceCents;
  const amountMatches =
    amountTolerance === undefined
      ? transaction.amountCents === obligation.amountCents
      : Math.abs(transaction.amountCents - obligation.amountCents) <= amountTolerance;
  if (!amountMatches) return false;

  const windowDays = settings.matchWindowDays ?? DEFAULT_OBLIGATION_MATCH_WINDOW_DAYS;
  return Math.abs(transaction.transactionDate.getTime() - occurrenceDate.getTime()) <= windowDays * MS_PER_DAY;
}

interface LowProjection {
  lowCents: Cents;
  lowDate: Date;
}

function projectLowBalance(startingCents: Cents, periodStart: Date, lineItems: ForecastLineItem[]): LowProjection {
  let running = startingCents;
  let lowCents = startingCents;
  let lowDate = periodStart;
  for (const item of lineItems) {
    running += item.amountCents;
    if (running < lowCents) {
      lowCents = running;
      lowDate = item.date;
    }
  }
  return { lowCents, lowDate };
}

function buildWarnings(
  lowCents: Cents | undefined,
  lowDate: Date | undefined,
  balanceCoverage: NonNullable<ForecastRun["balanceCoverage"]>,
): string[] {
  if (!balanceCoverage.isComplete) {
    const noun = balanceCoverage.missingCount === 1 ? "account has" : "accounts have";
    return [
      `${balanceCoverage.missingCount} cash-flow ${noun} no balance recorded; projection is paused until balances are entered.`,
    ];
  }
  if (lowCents === undefined || lowDate === undefined) return [];
  const on = lowDate.toISOString().slice(0, 10);
  if (lowCents < 0) {
    return [`Projected balance goes negative (${formatCents(lowCents)}) around ${on}.`];
  }
  if (lowCents < LOW_CUSHION_THRESHOLD_CENTS) {
    return [`Projected cushion is thin (${formatCents(lowCents)}) around ${on}.`];
  }
  return [];
}

function sourceForType(type: RecurringType): ForecastLineItemSource {
  switch (type) {
    case "PAYCHECK":
      return "PAYCHECK";
    case "BILL":
      return "RECURRING_BILL";
    case "SUBSCRIPTION":
      return "SUBSCRIPTION";
    default:
      return "MANUAL";
  }
}

function byDateThenLabel(a: ForecastLineItem, b: ForecastLineItem): number {
  const byDate = a.date.getTime() - b.date.getTime();
  if (byDate !== 0) return byDate;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}
