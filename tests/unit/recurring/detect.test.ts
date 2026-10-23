import { describe, it, expect } from "vitest";
import type { Transaction, TransactionState } from "@/lib/domain/types";
import { detectRecurring, type DetectContext } from "@/lib/domain/recurring/detect";
import { occurrencesBetween } from "@/lib/domain/recurring/schedule";

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

  it("infers a SEMI_MONTHLY paycheck from a 1st/15th series whose 14/16/17-day gaps sit in BIWEEKLY's band", () => {
    const [ob] = detectRecurring(
      [
        txn("s1", "Harbor Payroll", 250000, "2026-04-01"),
        txn("s2", "Harbor Payroll", 250000, "2026-04-15"),
        txn("s3", "Harbor Payroll", 250000, "2026-05-01"),
        txn("s4", "Harbor Payroll", 250000, "2026-05-15"),
        txn("s5", "Harbor Payroll", 250000, "2026-06-01"),
        txn("s6", "Harbor Payroll", 250000, "2026-06-15"),
        txn("s7", "Harbor Payroll", 250000, "2026-07-01"),
      ],
      ctx,
    );
    expect(ob!.type).toBe("PAYCHECK");
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([1, 15]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-07-15T00:00:00.000Z"));
  });

  it("infers a SEMI_MONTHLY [15, 31] schedule from a 15th / last-day series", () => {
    const [ob] = detectRecurring(
      [
        txn("e1", "Harbor Payroll", 250000, "2026-02-15"),
        txn("e2", "Harbor Payroll", 250000, "2026-02-28"),
        txn("e3", "Harbor Payroll", 250000, "2026-03-15"),
        txn("e4", "Harbor Payroll", 250000, "2026-03-31"),
        txn("e5", "Harbor Payroll", 250000, "2026-04-15"),
        txn("e6", "Harbor Payroll", 250000, "2026-04-30"),
        txn("e7", "Harbor Payroll", 250000, "2026-05-15"),
        txn("e8", "Harbor Payroll", 250000, "2026-05-31"),
        txn("e9", "Harbor Payroll", 250000, "2026-06-15"),
        txn("e10", "Harbor Payroll", 250000, "2026-06-30"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([15, 31]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-07-15T00:00:00.000Z"));
  });

  it("keeps constant 14-day gaps BIWEEKLY even when they also land on two days of the month", () => {
    // Feb 1 + 28 days is Mar 1 in a non-leap year, so this series fits 1st/15th too.
    const [ob] = detectRecurring(
      [
        txn("f1", "Payroll", 412000, "2026-02-01"),
        txn("f2", "Payroll", 412000, "2026-02-15"),
        txn("f3", "Payroll", 412000, "2026-03-01"),
        txn("f4", "Payroll", 412000, "2026-03-15"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("BIWEEKLY");
    expect(ob!.daysOfMonth).toBeUndefined();
  });

  it("keeps a drifting biweekly series BIWEEKLY even when a holiday shifts one gap", () => {
    // Jul 3 2026 is the observed Independence Day holiday, so that Friday's pay lands Thursday Jul 2.
    const [ob] = detectRecurring(
      [
        txn("h1", "Payroll", 412000, "2026-05-22"),
        txn("h2", "Payroll", 412000, "2026-06-05"),
        txn("h3", "Payroll", 412000, "2026-06-19"),
        txn("h4", "Payroll", 412000, "2026-07-02"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("BIWEEKLY");
    expect(ob!.daysOfMonth).toBeUndefined();
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-07-16T00:00:00.000Z"));
  });

  it("needs a repeated day of the month before it pins a series to the calendar", () => {
    const [ob] = detectRecurring(
      [txn("t1", "Payroll", 412000, "2026-06-15"), txn("t2", "Payroll", 412000, "2026-07-01")],
      ctx,
    );
    expect(ob!.frequency).toBe("BIWEEKLY");
    expect(ob!.daysOfMonth).toBeUndefined();
  });

  it("infers SEMI_MONTHLY from a 1st/15th paycheck whose weekend paydays moved to the Friday before", () => {
    // Feb 1, Feb 15, Mar 1 and Mar 15 2026 are Sundays, paid Jan 30, Feb 13, Feb 27 and Mar 13.
    const [ob] = detectRecurring(
      [
        txn("w1", "Harbor Payroll", 250000, "2026-01-01"),
        txn("w2", "Harbor Payroll", 250000, "2026-01-15"),
        txn("w3", "Harbor Payroll", 250000, "2026-01-30"),
        txn("w4", "Harbor Payroll", 250000, "2026-02-13"),
        txn("w5", "Harbor Payroll", 250000, "2026-02-27"),
        txn("w6", "Harbor Payroll", 250000, "2026-03-13"),
        txn("w7", "Harbor Payroll", 250000, "2026-04-01"),
        txn("w8", "Harbor Payroll", 250000, "2026-04-15"),
      ],
      { asOf: new Date("2026-04-20T12:00:00.000Z") },
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([1, 15]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-05-01T00:00:00.000Z"));
  });

  it("infers SEMI_MONTHLY from a 1st/15th paycheck whose weekend paydays moved to the Monday after", () => {
    // Aug 1 and Aug 15 2026 are Saturdays (paid Aug 3, Aug 17); Nov 1 and Nov 15 are Sundays (paid Nov 2, Nov 16).
    const [ob] = detectRecurring(
      [
        txn("m1", "Harbor Payroll", 250000, "2026-07-01"),
        txn("m2", "Harbor Payroll", 250000, "2026-07-15"),
        txn("m3", "Harbor Payroll", 250000, "2026-08-03"),
        txn("m4", "Harbor Payroll", 250000, "2026-08-17"),
        txn("m5", "Harbor Payroll", 250000, "2026-09-01"),
        txn("m6", "Harbor Payroll", 250000, "2026-09-15"),
        txn("m7", "Harbor Payroll", 250000, "2026-10-01"),
        txn("m8", "Harbor Payroll", 250000, "2026-10-15"),
        txn("m9", "Harbor Payroll", 250000, "2026-11-02"),
        txn("m10", "Harbor Payroll", 250000, "2026-11-16"),
      ],
      { asOf: new Date("2026-11-20T12:00:00.000Z") },
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([1, 15]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-12-01T00:00:00.000Z"));
  });

  it("infers [15, 31] from a 15th / last-day paycheck paid the Friday before weekend paydays", () => {
    // Jan 31 and Feb 28 2026 are Saturdays (paid Jan 30, Feb 27); Feb 15 and Mar 15 are Sundays (paid Feb 13, Mar 13).
    const [ob] = detectRecurring(
      [
        txn("l1", "Harbor Payroll", 250000, "2026-01-15"),
        txn("l2", "Harbor Payroll", 250000, "2026-01-30"),
        txn("l3", "Harbor Payroll", 250000, "2026-02-13"),
        txn("l4", "Harbor Payroll", 250000, "2026-02-27"),
        txn("l5", "Harbor Payroll", 250000, "2026-03-13"),
        txn("l6", "Harbor Payroll", 250000, "2026-03-31"),
        txn("l7", "Harbor Payroll", 250000, "2026-04-15"),
        txn("l8", "Harbor Payroll", 250000, "2026-04-30"),
      ],
      { asOf: new Date("2026-05-02T12:00:00.000Z") },
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([15, 31]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-05-15T00:00:00.000Z"));
  });

  it("reads a February month-end as the last day, so a 15th / last-day paycheck projects March 31", () => {
    const [ob] = detectRecurring(
      [
        txn("a1", "Harbor Payroll", 250000, "2026-02-15"),
        txn("a2", "Harbor Payroll", 250000, "2026-02-28"),
        txn("a3", "Harbor Payroll", 250000, "2026-03-15"),
      ],
      { asOf: new Date("2026-03-20T12:00:00.000Z") },
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([15, 31]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-03-31T00:00:00.000Z"));
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", new Date("2026-03-16T00:00:00.000Z"), new Date("2026-04-30T00:00:00.000Z"), ob!.daysOfMonth)).toEqual([
      new Date("2026-03-31T00:00:00.000Z"),
      new Date("2026-04-15T00:00:00.000Z"),
      new Date("2026-04-30T00:00:00.000Z"),
    ]);
  });

  it("reads a 30-day month's end as the last day too, so it projects May 31", () => {
    const [ob] = detectRecurring(
      [
        txn("c1", "Harbor Payroll", 250000, "2026-04-15"),
        txn("c2", "Harbor Payroll", 250000, "2026-04-30"),
        txn("c3", "Harbor Payroll", 250000, "2026-05-15"),
      ],
      { asOf: new Date("2026-05-20T12:00:00.000Z") },
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([15, 31]);
    expect(ob!.nextExpectedDate).toEqual(new Date("2026-05-31T00:00:00.000Z"));
  });

  it("keeps a biweekly series with one late posting BIWEEKLY rather than reading an uneven 13th / last-day schedule", () => {
    // Biweekly Fridays Feb 13, Feb 27, Mar 13 2026, with Feb 27 posting a day late on Feb 28.
    const [ob] = detectRecurring(
      [
        txn("b1", "Payroll", 412000, "2026-02-13"),
        txn("b2", "Payroll", 412000, "2026-02-28"),
        txn("b3", "Payroll", 412000, "2026-03-13"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("BIWEEKLY");
    expect(ob!.daysOfMonth).toBeUndefined();
  });

  it("caps the confidence of a fit that needed weekend moves — a biweekly series whose Labor Day pay moved to the Friday before", () => {
    // Monday paydays Sep 7 2026 (Labor Day, paid Fri Sep 4), Sep 21, Oct 5, Oct 19. A KNOWN false positive
    // (deferred to Task 1b.6): Sep 4 and Sep 21 fit days 5 and 19 only through weekend moves.
    const [ob] = detectRecurring(
      [
        txn("ld1", "Payroll", 412000, "2026-09-04"),
        txn("ld2", "Payroll", 412000, "2026-09-21"),
        txn("ld3", "Payroll", 412000, "2026-10-05"),
        txn("ld4", "Payroll", 412000, "2026-10-19"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([5, 19]);
    expect(ob!.confidenceScore).toBe(60);
  });

  it("caps the confidence of a fit that needed a month-end clamp — a biweekly series with Feb 27 posted on Feb 28", () => {
    // A KNOWN false positive (deferred to Task 1b.6) needing no weekend move: day 30 reaches Feb 28 only by clamping.
    const [ob] = detectRecurring(
      [
        txn("cx1", "Payroll", 412000, "2026-01-30"),
        txn("cx2", "Payroll", 412000, "2026-02-13"),
        txn("cx3", "Payroll", 412000, "2026-02-28"),
        txn("cx4", "Payroll", 412000, "2026-03-13"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.daysOfMonth).toEqual([13, 30]);
    expect(ob!.confidenceScore).toBe(60);
  });

  it("keeps full confidence for a semi-monthly fit with no weekend move or month-end clamp", () => {
    const [ob] = detectRecurring(
      [
        txn("k1", "Harbor Payroll", 250000, "2026-04-01"),
        txn("k2", "Harbor Payroll", 250000, "2026-04-15"),
        txn("k3", "Harbor Payroll", 250000, "2026-05-01"),
        txn("k4", "Harbor Payroll", 250000, "2026-05-15"),
        txn("k5", "Harbor Payroll", 250000, "2026-06-01"),
        txn("k6", "Harbor Payroll", 250000, "2026-06-15"),
        txn("k7", "Harbor Payroll", 250000, "2026-07-01"),
      ],
      ctx,
    );
    expect(ob!.frequency).toBe("SEMI_MONTHLY");
    expect(ob!.confidenceScore).toBe(95);
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
