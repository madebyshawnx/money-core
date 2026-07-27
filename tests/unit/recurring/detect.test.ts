import { describe, it, expect } from "vitest";
import type { Transaction, TransactionState } from "@/lib/domain/types";
import { detectRecurring, type DetectContext } from "@/lib/domain/recurring/detect";

const ctx: DetectContext = { asOf: new Date("2026-07-11T12:00:00.000Z") };

function txn(id: string, merchant: string, amountCents: number, iso: string, state: TransactionState = "POSTED"): Transaction {
  return {
    id,
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date(iso),
    amountCents,
    currencyCode: "USD",
    merchantNormalized: merchant,
    state,
    isPending: false,
    isExcludedFromSpending: amountCents > 0,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
  };
}

describe("recurring detect", () => {
  it("infers a MONTHLY bill from three regular same-merchant outflows", () => {
    const [ob] = detectRecurring(
      [
        txn("m1", "Cascade Mortgage", -215000, "2026-04-15"),
        txn("m2", "Cascade Mortgage", -215000, "2026-05-15"),
        txn("m3", "Cascade Mortgage", -215000, "2026-06-15"),
      ],
      ctx,
    );
    expect(ob).toBeDefined();
    expect(ob!.frequency).toBe("MONTHLY");
    expect(ob!.type).toBe("BILL");
    expect(ob!.amountCents).toBe(-215000);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-07-15T00:00:00.000Z"));
    expect(ob!.isConfirmed).toBe(false); // newly detected, awaiting approval
    expect(ob!.includeInForecast).toBe(false);
    expect(ob!.isActive).toBe(true);
  });

  it("infers a BIWEEKLY paycheck from regular inflows", () => {
    const [ob] = detectRecurring(
      [
        txn("p1", "Payroll", 412000, "2026-06-03"),
        txn("p2", "Payroll", 412000, "2026-06-17"),
        txn("p3", "Payroll", 412000, "2026-07-01"),
      ],
      ctx,
    );
    expect(ob!.type).toBe("PAYCHECK");
    expect(ob!.frequency).toBe("BIWEEKLY");
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-07-15T00:00:00.000Z"));
  });

  it("classifies a small recurring charge as a SUBSCRIPTION", () => {
    const [ob] = detectRecurring(
      [
        txn("n1", "Netflix", -1899, "2026-05-08"),
        txn("n2", "Netflix", -1899, "2026-06-08"),
        txn("n3", "Netflix", -1899, "2026-07-08"),
      ],
      ctx,
    );
    expect(ob!.type).toBe("SUBSCRIPTION");
    expect(ob!.frequency).toBe("MONTHLY");
  });

  it("does not infer recurrence from a single occurrence", () => {
    expect(detectRecurring([txn("s1", "One Off", -5000, "2026-06-01")], ctx)).toEqual([]);
  });

  it("ignores removed transactions", () => {
    const out = detectRecurring(
      [
        txn("g1", "Ghost", -1000, "2026-05-01", "REMOVED"),
        txn("g2", "Ghost", -1000, "2026-06-01", "REMOVED"),
        txn("g3", "Ghost", -1000, "2026-07-01", "REMOVED"),
      ],
      ctx,
    );
    expect(out).toEqual([]);
  });

  it("skips a merchant whose amounts vary too much to be a stable obligation", () => {
    const out = detectRecurring(
      [
        txn("c1", "Costco", -18932, "2026-05-01"),
        txn("c2", "Costco", -4200, "2026-06-01"),
        txn("c3", "Costco", -31050, "2026-07-01"),
      ],
      ctx,
    );
    expect(out).toEqual([]);
  });

  it("is deterministic (same input → identical output)", () => {
    const input = [
      txn("m1", "Cascade Mortgage", -215000, "2026-05-15"),
      txn("m2", "Cascade Mortgage", -215000, "2026-06-15"),
    ];
    expect(detectRecurring(input, ctx)).toEqual(detectRecurring(input, ctx));
  });
});
