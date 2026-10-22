import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  projectNextExpected,
  occurrencesBetween,
} from "@/lib/domain/recurring/schedule";

const d = (iso: string) => new Date(iso);

describe("recurring schedule — nextOccurrence", () => {
  it("advances WEEKLY by 7 days and BIWEEKLY by 14 days", () => {
    expect(nextOccurrence(d("2026-07-01T00:00:00.000Z"), "WEEKLY")).toEqual(d("2026-07-08T00:00:00.000Z"));
    expect(nextOccurrence(d("2026-07-01T00:00:00.000Z"), "BIWEEKLY")).toEqual(d("2026-07-15T00:00:00.000Z"));
  });

  it("advances MONTHLY by a calendar month preserving day-of-month", () => {
    expect(nextOccurrence(d("2026-07-15T00:00:00.000Z"), "MONTHLY")).toEqual(d("2026-08-15T00:00:00.000Z"));
  });

  it("clamps MONTHLY to the last day of a shorter month", () => {
    expect(nextOccurrence(d("2026-01-31T00:00:00.000Z"), "MONTHLY")).toEqual(d("2026-02-28T00:00:00.000Z"));
  });

  it("lists month-end occurrences from the original anchor day without drift", () => {
    const out = occurrencesBetween(d("2026-01-31T00:00:00.000Z"), "MONTHLY", d("2026-02-01T00:00:00.000Z"), d("2026-04-30T00:00:00.000Z"));
    expect(out).toEqual([
      d("2026-02-28T00:00:00.000Z"),
      d("2026-03-31T00:00:00.000Z"),
      d("2026-04-30T00:00:00.000Z"),
    ]);
  });

  it("clamps a 30th anchor across February then returns to the 30th", () => {
    const out = occurrencesBetween(d("2026-01-30T00:00:00.000Z"), "MONTHLY", d("2026-02-01T00:00:00.000Z"), d("2026-03-31T00:00:00.000Z"));
    expect(out).toEqual([d("2026-02-28T00:00:00.000Z"), d("2026-03-30T00:00:00.000Z")]);
  });

  it("clamps leap-day monthly and annual anchors per target month or year", () => {
    expect(occurrencesBetween(d("2024-02-29T00:00:00.000Z"), "MONTHLY", d("2025-02-01T00:00:00.000Z"), d("2025-03-31T00:00:00.000Z"))).toEqual([
      d("2025-02-28T00:00:00.000Z"),
      d("2025-03-29T00:00:00.000Z"),
    ]);
    expect(nextOccurrence(d("2024-02-29T00:00:00.000Z"), "ANNUAL")).toEqual(d("2025-02-28T00:00:00.000Z"));
  });

  it("advances QUARTERLY by 3 months and ANNUAL by 12 months", () => {
    expect(nextOccurrence(d("2026-07-15T00:00:00.000Z"), "QUARTERLY")).toEqual(d("2026-10-15T00:00:00.000Z"));
    expect(nextOccurrence(d("2026-07-15T00:00:00.000Z"), "ANNUAL")).toEqual(d("2027-07-15T00:00:00.000Z"));
  });

  it("returns undefined for IRREGULAR (not projectable)", () => {
    expect(nextOccurrence(d("2026-07-15T00:00:00.000Z"), "IRREGULAR")).toBeUndefined();
  });
});

describe("recurring schedule — projectNextExpected", () => {
  it("advances from the last occurrence to the first date strictly after asOf", () => {
    const next = projectNextExpected(d("2026-07-01T00:00:00.000Z"), "MONTHLY", d("2026-09-15T00:00:00.000Z"));
    expect(next).toEqual(d("2026-10-01T00:00:00.000Z"));
  });

  it("projects month-end dates from the original anchor day without drift", () => {
    const next = projectNextExpected(d("2026-01-31T00:00:00.000Z"), "MONTHLY", d("2026-03-01T00:00:00.000Z"));
    expect(next).toEqual(d("2026-03-31T00:00:00.000Z"));
  });

  it("returns the last occurrence when it is already in the future", () => {
    const next = projectNextExpected(d("2026-08-01T00:00:00.000Z"), "MONTHLY", d("2026-07-15T00:00:00.000Z"));
    expect(next).toEqual(d("2026-08-01T00:00:00.000Z"));
  });

  it("returns undefined for IRREGULAR", () => {
    expect(projectNextExpected(d("2026-07-01T00:00:00.000Z"), "IRREGULAR", d("2026-09-01T00:00:00.000Z"))).toBeUndefined();
  });
});

describe("recurring schedule — occurrencesBetween", () => {
  it("lists every occurrence within an inclusive window", () => {
    const out = occurrencesBetween(d("2026-07-15T00:00:00.000Z"), "MONTHLY", d("2026-07-01T00:00:00.000Z"), d("2026-10-01T00:00:00.000Z"));
    expect(out).toEqual([
      d("2026-07-15T00:00:00.000Z"),
      d("2026-08-15T00:00:00.000Z"),
      d("2026-09-15T00:00:00.000Z"),
    ]);
  });

  it("steps forward to the first occurrence at or after the window start", () => {
    const out = occurrencesBetween(d("2026-05-10T00:00:00.000Z"), "MONTHLY", d("2026-07-01T00:00:00.000Z"), d("2026-08-31T00:00:00.000Z"));
    expect(out).toEqual([d("2026-07-10T00:00:00.000Z"), d("2026-08-10T00:00:00.000Z")]);
  });

  it("returns an empty list for IRREGULAR", () => {
    expect(occurrencesBetween(d("2026-07-15T00:00:00.000Z"), "IRREGULAR", d("2026-07-01T00:00:00.000Z"), d("2026-10-01T00:00:00.000Z"))).toEqual([]);
  });

  it("steps a BIWEEKLY bill 14 days from its anchor, and yields no dates without one", () => {
    expect(occurrencesBetween(d("2026-07-03T00:00:00.000Z"), "BIWEEKLY", d("2026-07-01T00:00:00.000Z"), d("2026-07-31T00:00:00.000Z"))).toEqual([
      d("2026-07-03T00:00:00.000Z"),
      d("2026-07-17T00:00:00.000Z"),
      d("2026-07-31T00:00:00.000Z"),
    ]);
    expect(occurrencesBetween(undefined, "BIWEEKLY", d("2026-07-01T00:00:00.000Z"), d("2026-07-31T00:00:00.000Z"))).toEqual([]);
  });
});

describe("recurring schedule — SEMI_MONTHLY", () => {
  it("yields 24 dates a year for a bill on days [1, 15]", () => {
    const out = occurrencesBetween(undefined, "SEMI_MONTHLY", d("2026-01-01T00:00:00.000Z"), d("2026-12-31T00:00:00.000Z"), [1, 15]);
    const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
    expect(out).toHaveLength(24);
    expect(out).toEqual(months.flatMap((mm) => [d(`2026-${mm}-01T00:00:00.000Z`), d(`2026-${mm}-15T00:00:00.000Z`)]));
  });

  it("lands a day past a month's end on that month's last day", () => {
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", d("2026-01-01T00:00:00.000Z"), d("2026-04-30T00:00:00.000Z"), [15, 31])).toEqual([
      d("2026-01-15T00:00:00.000Z"),
      d("2026-01-31T00:00:00.000Z"),
      d("2026-02-15T00:00:00.000Z"),
      d("2026-02-28T00:00:00.000Z"),
      d("2026-03-15T00:00:00.000Z"),
      d("2026-03-31T00:00:00.000Z"),
      d("2026-04-15T00:00:00.000Z"),
      d("2026-04-30T00:00:00.000Z"),
    ]);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", d("2028-02-01T00:00:00.000Z"), d("2028-02-29T00:00:00.000Z"), [15, 30])).toEqual([
      d("2028-02-15T00:00:00.000Z"),
      d("2028-02-29T00:00:00.000Z"),
    ]);
  });

  it("orders the days and counts days that land on the same date once", () => {
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", d("2026-02-01T00:00:00.000Z"), d("2026-03-31T00:00:00.000Z"), [31, 15, 30])).toEqual([
      d("2026-02-15T00:00:00.000Z"),
      d("2026-02-28T00:00:00.000Z"),
      d("2026-03-15T00:00:00.000Z"),
      d("2026-03-30T00:00:00.000Z"),
      d("2026-03-31T00:00:00.000Z"),
    ]);
  });

  it("never lists a date before its anchor, and carries the anchor's time of day", () => {
    expect(occurrencesBetween(d("2026-07-10T09:30:00.000Z"), "SEMI_MONTHLY", d("2026-07-01T00:00:00.000Z"), d("2026-08-31T23:59:59.999Z"), [1, 15])).toEqual([
      d("2026-07-15T09:30:00.000Z"),
      d("2026-08-01T09:30:00.000Z"),
      d("2026-08-15T09:30:00.000Z"),
    ]);
  });

  it("cannot be placed without valid days of the month", () => {
    const start = d("2026-07-01T00:00:00.000Z");
    const end = d("2026-07-31T00:00:00.000Z");
    expect(occurrencesBetween(start, "SEMI_MONTHLY", start, end)).toEqual([]);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", start, end, [])).toEqual([]);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", start, end, [0, 15])).toEqual([]);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", start, end, [1, 32])).toEqual([]);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", start, end, [1.5, 15])).toEqual([]);
    expect(nextOccurrence(start, "SEMI_MONTHLY")).toBeUndefined();
    expect(projectNextExpected(start, "SEMI_MONTHLY", d("2026-07-11T00:00:00.000Z"))).toBeUndefined();
  });

  it("never lists more than the safety bound of dates, however long the window", () => {
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", d("2026-01-01T00:00:00.000Z"), d("2200-01-01T00:00:00.000Z"), [1])).toHaveLength(1000);
    expect(occurrencesBetween(undefined, "SEMI_MONTHLY", d("2026-01-01T00:00:00.000Z"), d("2200-01-01T00:00:00.000Z"), [1, 15])).toHaveLength(1000);
  });

  it("projects the next date strictly after asOf, never before the last occurrence", () => {
    expect(projectNextExpected(d("2026-07-01T00:00:00.000Z"), "SEMI_MONTHLY", d("2026-07-15T00:00:00.000Z"), [1, 15])).toEqual(d("2026-08-01T00:00:00.000Z"));
    expect(projectNextExpected(d("2026-08-15T00:00:00.000Z"), "SEMI_MONTHLY", d("2026-07-11T00:00:00.000Z"), [1, 15])).toEqual(d("2026-08-15T00:00:00.000Z"));
  });
});
