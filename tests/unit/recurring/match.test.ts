import { describe, it, expect } from "vitest";
import type { RecurringObligation, Transaction } from "@/lib/domain/types";
import { statusOf, matchObligations, type MatchContext } from "@/lib/domain/recurring/match";

const ctx: MatchContext = { asOf: new Date("2026-07-11T12:00:00.000Z") };

function ob(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: "rec_mortgage",
    householdId: "hh_1",
    type: "BILL",
    name: "Cascade Mortgage",
    merchantNormalized: "Cascade Mortgage",
    amountCents: -215000,
    frequency: "MONTHLY",
    nextExpectedDate: new Date("2026-07-15T00:00:00.000Z"),
    confidenceScore: 90,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_1",
    ...overrides,
  };
}

function txn(id: string, merchant: string, amountCents: number, iso: string): Transaction {
  return {
    id,
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date(iso),
    amountCents,
    currencyCode: "USD",
    merchantNormalized: merchant,
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
  };
}

describe("recurring match — statusOf", () => {
  it("is PAID when a matching transaction posts near the expected date", () => {
    const r = statusOf(ob(), [txn("t", "Cascade Mortgage", -215000, "2026-07-14")], ctx);
    expect(r.status).toBe("PAID");
    expect(r.matchedTransactionId).toBe("t");
  });

  it("is DUE when the expected date is within the due window and unpaid", () => {
    const r = statusOf(ob({ nextExpectedDate: new Date("2026-07-13T00:00:00.000Z") }), [], ctx);
    expect(r.status).toBe("DUE");
  });

  it("is OVERDUE when the expected date has passed and no matching transaction exists", () => {
    const r = statusOf(ob({ nextExpectedDate: new Date("2026-07-05T00:00:00.000Z") }), [], ctx);
    expect(r.status).toBe("OVERDUE");
  });

  it("is UPCOMING when the expected date is beyond the due window", () => {
    const r = statusOf(ob({ nextExpectedDate: new Date("2026-08-15T00:00:00.000Z") }), [], ctx);
    expect(r.status).toBe("UPCOMING");
  });

  it("does not match a transaction whose amount is outside tolerance", () => {
    const r = statusOf(ob({ nextExpectedDate: new Date("2026-07-13T00:00:00.000Z") }), [txn("t", "Cascade Mortgage", -50000, "2026-07-14")], ctx);
    expect(r.status).toBe("DUE");
    expect(r.matchedTransactionId).toBeUndefined();
  });

  it("is INACTIVE for an inactive obligation", () => {
    expect(statusOf(ob({ isActive: false }), [], ctx).status).toBe("INACTIVE");
  });
});

describe("recurring match — matchObligations", () => {
  it("returns a status result per obligation", () => {
    const results = matchObligations(
      [ob({ id: "a", nextExpectedDate: new Date("2026-07-13T00:00:00.000Z") }), ob({ id: "b", nextExpectedDate: new Date("2026-09-01T00:00:00.000Z") })],
      [],
      ctx,
    );
    expect(results.map((r) => `${r.obligation.id}:${r.status}`)).toEqual(["a:DUE", "b:UPCOMING"]);
  });

  it("allocates one matching transaction to only the closest obligation", () => {
    const results = matchObligations(
      [
        ob({ id: "later", nextExpectedDate: new Date("2026-07-17T00:00:00.000Z") }),
        ob({ id: "closer", nextExpectedDate: new Date("2026-07-14T00:00:00.000Z") }),
      ],
      [txn("t", "Cascade Mortgage", -215000, "2026-07-14")],
      ctx,
    );

    expect(results.map((r) => [r.obligation.id, r.status, r.matchedTransactionId])).toEqual([
      ["later", "DUE", undefined],
      ["closer", "PAID", "t"],
    ]);
  });
});
