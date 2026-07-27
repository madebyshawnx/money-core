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
});
