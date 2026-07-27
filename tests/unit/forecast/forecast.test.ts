import { describe, it, expect } from "vitest";
import type { FinancialAccount, RecurringObligation, Transaction } from "@/lib/domain/types";
import { buildForecast, LOW_CUSHION_THRESHOLD_CENTS, type ForecastInput } from "@/lib/domain/forecast/forecast";

function account(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: "acct_c",
    householdId: "hh_1",
    displayName: "Checking",
    type: "CHECKING",
    currencyCode: "USD",
    lastBalanceCents: 100000,
    lastBalanceAvailableCents: 100000,
    includeInForecast: true,
    isDisconnected: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-07-01"),
    ...overrides,
  };
}

function obligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: "rec_1",
    householdId: "hh_1",
    type: "BILL",
    name: "Rent",
    amountCents: -30000,
    frequency: "MONTHLY",
    nextExpectedDate: new Date("2026-07-05T00:00:00.000Z"),
    confidenceScore: 90,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_c",
    ...overrides,
  };
}

function pendingTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_p",
    householdId: "hh_1",
    accountId: "acct_c",
    transactionDate: new Date("2026-07-03T00:00:00.000Z"),
    amountCents: -4200,
    currencyCode: "USD",
    merchantNormalized: "Osteria Verde",
    state: "PENDING",
    isPending: true,
    isExcludedFromSpending: false,
    isForecastRelevant: true,
    confidenceScore: 80,
    tagIds: [],
    ...overrides,
  };
}

const period = { periodStart: new Date("2026-07-01T00:00:00.000Z"), periodEnd: new Date("2026-07-31T00:00:00.000Z") };

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    householdId: "hh_1",
    accounts: [account()],
    obligations: [],
    transactions: [],
    ...period,
    makeRunId: () => "run_1",
    ...overrides,
  };
}

describe("forecast — starting balance", () => {
  it("sums available balances of connected liquid accounts, excluding credit and disconnected", () => {
    const run = buildForecast(
      input({
        accounts: [
          account({ id: "chk", type: "CHECKING", lastBalanceAvailableCents: 241000 }),
          account({ id: "sav", type: "SAVINGS", lastBalanceAvailableCents: 830000 }),
          account({ id: "card", type: "CREDIT_CARD", lastBalanceAvailableCents: -142500 }),
          account({ id: "old", type: "CHECKING", isDisconnected: true, includeInForecast: false, lastBalanceAvailableCents: 15200 }),
        ],
      }),
    );
    expect(run.startingBalanceCents).toBe(241000 + 830000);
  });

  it("falls back to current balance when available balance is missing", () => {
    const run = buildForecast(input({ accounts: [account({ lastBalanceAvailableCents: undefined, lastBalanceCents: 55000 })] }));
    expect(run.startingBalanceCents).toBe(55000);
  });

  it("marks the cash-flow projection incomplete when included liquid accounts have no balance", () => {
    const run = buildForecast(
      input({
        accounts: [
          account({ id: "chk", type: "CHECKING", lastBalanceAvailableCents: 25000, lastBalanceCents: 25000 }),
          account({ id: "sav", type: "SAVINGS", lastBalanceAvailableCents: undefined, lastBalanceCents: undefined }),
        ],
        obligations: [obligation({ amountCents: -10000 })],
      }),
    );

    expect(run.balanceCoverage).toMatchObject({
      recordedCount: 1,
      totalCount: 2,
      missingCount: 1,
      isComplete: false,
    });
    expect(run.projectedLowBalanceCents).toBeUndefined();
    expect(run.cushionCents).toBeUndefined();
    expect(run.warnings.some((warning) => warning.includes("1 cash-flow account has no balance recorded"))).toBe(true);
  });
});

describe("forecast — line items", () => {
  it("projects each recurring occurrence within the period with the mapped source and sign", () => {
    const run = buildForecast(
      input({
        obligations: [
          obligation({ type: "PAYCHECK", amountCents: 412000, frequency: "BIWEEKLY", nextExpectedDate: new Date("2026-07-03T00:00:00.000Z") }),
        ],
      }),
    );
    const pay = run.lineItems.filter((l) => l.source === "PAYCHECK");
    expect(pay).toHaveLength(3); // biweekly within Jul 1–31 inclusive: Jul 3, 17, 31
    expect(pay[0]!.amountCents).toBe(412000);
  });

  it("includes forecast-relevant pending transactions as line items", () => {
    const run = buildForecast(input({ transactions: [pendingTxn()] }));
    const pend = run.lineItems.filter((l) => l.source === "PENDING_TRANSACTION");
    expect(pend).toHaveLength(1);
    expect(pend[0]!.amountCents).toBe(-4200);
  });

  it("keeps a matching pending transaction and suppresses the recurring occurrence", () => {
    const run = buildForecast(
      input({
        obligations: [obligation({ amountCents: -30000, nextExpectedDate: new Date("2026-07-05T00:00:00.000Z") })],
        transactions: [
          pendingTxn({
            id: "txn_rent_pending",
            amountCents: -30000,
            transactionDate: new Date("2026-07-03T00:00:00.000Z"),
            merchantNormalized: "Rent",
          }),
        ],
      }),
    );

    expect(run.lineItems).toHaveLength(1);
    expect(run.lineItems[0]!.source).toBe("PENDING_TRANSACTION");
    expect(run.lineItems[0]!.evidenceId).toBe("txn_rent_pending");
  });

  it("ignores transactions that are not forecast-relevant", () => {
    const run = buildForecast(input({ transactions: [pendingTxn({ isForecastRelevant: false })] }));
    expect(run.lineItems).toHaveLength(0);
  });

  it("returns line items sorted by date", () => {
    const run = buildForecast(
      input({
        obligations: [
          obligation({ id: "late", nextExpectedDate: new Date("2026-07-20T00:00:00.000Z") }),
          obligation({ id: "early", nextExpectedDate: new Date("2026-07-05T00:00:00.000Z") }),
        ],
      }),
    );
    const dates = run.lineItems.map((l) => l.date.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });
});

describe("forecast — projection & warnings", () => {
  it("tracks the projected low balance and its date along the running path", () => {
    const run = buildForecast(
      input({
        accounts: [account({ lastBalanceAvailableCents: 100000 })],
        obligations: [
          obligation({ id: "bill", amountCents: -30000, nextExpectedDate: new Date("2026-07-05T00:00:00.000Z") }),
          obligation({ id: "pay", type: "PAYCHECK", amountCents: 50000, frequency: "MONTHLY", nextExpectedDate: new Date("2026-07-10T00:00:00.000Z") }),
        ],
      }),
    );
    expect(run.projectedLowBalanceCents).toBe(70000);
    expect(run.projectedLowDate).toEqual(new Date("2026-07-05T00:00:00.000Z"));
  });

  it("warns when the projected balance goes negative", () => {
    const run = buildForecast(input({ accounts: [account({ lastBalanceAvailableCents: 10000 })], obligations: [obligation({ amountCents: -30000 })] }));
    expect(run.projectedLowBalanceCents).toBeLessThan(0);
    expect(run.warnings.some((w) => /negative/i.test(w))).toBe(true);
  });

  it("warns on a thin (non-negative) cushion below the threshold", () => {
    const run = buildForecast(
      input({ accounts: [account({ lastBalanceAvailableCents: 25000 })], obligations: [obligation({ amountCents: -10000 })] }),
    );
    expect(run.projectedLowBalanceCents).toBe(15000);
    expect(run.projectedLowBalanceCents).toBeLessThan(LOW_CUSHION_THRESHOLD_CENTS);
    expect(run.warnings.some((w) => /cushion/i.test(w))).toBe(true);
  });

  it("sets confidence to the minimum line-item confidence", () => {
    const run = buildForecast(
      input({
        obligations: [
          obligation({ id: "a", confidenceScore: 95 }),
          obligation({ id: "b", confidenceScore: 62, nextExpectedDate: new Date("2026-07-12T00:00:00.000Z") }),
        ],
      }),
    );
    expect(run.confidenceScore).toBe(62);
  });

  it("is deterministic given a fixed run id", () => {
    expect(buildForecast(input({ obligations: [obligation()] }))).toEqual(buildForecast(input({ obligations: [obligation()] })));
  });
});
