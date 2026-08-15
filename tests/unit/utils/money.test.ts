/**
 * MC-5 — the canonical money primitive, upstreamed from PennyBank.
 *
 * The old module's `dollarsToCents` was `Math.round(dollars * 100)`, which
 * disagrees with the decimal the user actually typed: the multiplication
 * introduces representation error BEFORE the rounding happens, so 1.005
 * became 100 where the typed decimal says 101. In the package three apps are
 * meant to converge on, that is a wrong financial answer, not a style choice.
 *
 * `Cents` stays a plain number (domain field types across three apps depend
 * on it — branding it is a deliberate coordinated migration, not a drive-by);
 * `StrictCents` carries the brand for new strong-path code, and is assignable
 * TO `Cents` fields so strong outputs flow into domain types seamlessly.
 */

import { describe, expect, it } from "vitest";
import {
  ceilCents,
  clampCents,
  dollarsToCents,
  floorCents,
  formatCents,
  largestRemainderSplit,
  maxCents,
  minCents,
  parseDollarInput,
  roundCents,
  strictCents,
  sumCents,
  toPlainDecimalString,
  ZERO_CENTS,
} from "@/lib/utils/money";

describe("dollarsToCents — exact decimal conversion, half away from zero", () => {
  it("rounds on the typed decimal, not the binary artefact underneath it", () => {
    // Math.round(1.005 * 100) === 100 — the defect this replacement removes.
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(0.615)).toBe(62);
  });

  it("is symmetric for negative money", () => {
    expect(dollarsToCents(-1.005)).toBe(-101);
    expect(dollarsToCents(-0.615)).toBe(-62);
  });

  it("converts exact two-decimal values without surprise", () => {
    expect(dollarsToCents(12.34)).toBe(1234);
    expect(dollarsToCents(-52.1)).toBe(-5210);
    expect(dollarsToCents(0)).toBe(0);
  });

  it("refuses what cannot be represented rather than losing precision", () => {
    expect(dollarsToCents(Number.NaN)).toBeNull();
    expect(dollarsToCents(Number.POSITIVE_INFINITY)).toBeNull();
    expect(dollarsToCents(Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe("parseDollarInput — human-typed money", () => {
  it("tolerates currency symbols, separators and whitespace", () => {
    expect(parseDollarInput(" $1,753.08 ")).toBe(175308);
    expect(parseDollarInput("-$29.99")).toBe(-2999);
  });

  it("returns null, never zero, for non-numbers", () => {
    expect(parseDollarInput("")).toBeNull();
    expect(parseDollarInput("-")).toBeNull();
    expect(parseDollarInput("twelve")).toBeNull();
  });
});

describe("rounding boundaries", () => {
  it("roundCents is half away from zero and refuses non-finite input", () => {
    expect(roundCents(52.5924 * 100)).toBe(5259);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(-1.5)).toBe(-2); // Math.round(-1.5) is -1 — not this.
    expect(roundCents(Number.NaN)).toBeNull();
  });

  it("floorCents and ceilCents exist for the directional call sites", () => {
    expect(floorCents(99.9)).toBe(99);
    expect(ceilCents(99.1)).toBe(100);
  });
});

describe("aggregate helpers keep exactness", () => {
  it("sums exactly with no drift", () => {
    expect(sumCents([strictCents(1), strictCents(2), strictCents(-3)])).toBe(0);
  });

  it("min/max/clamp preserve values", () => {
    expect(minCents(strictCents(5), strictCents(7))).toBe(5);
    expect(maxCents(strictCents(5), strictCents(7))).toBe(7);
    expect(clampCents(strictCents(9), strictCents(0), strictCents(7))).toBe(7);
  });
});

describe("largestRemainderSplit — parts sum to exactly the total", () => {
  it("distributes every remaining cent", () => {
    const parts = largestRemainderSplit(strictCents(100), [1, 1, 1]);

    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it("hands zero weights an all-zero split rather than NaN", () => {
    expect(largestRemainderSplit(strictCents(100), [0, 0])).toEqual([ZERO_CENTS, ZERO_CENTS]);
    expect(largestRemainderSplit(strictCents(100), [])).toEqual([]);
  });
});

describe("compatibility surface", () => {
  it("formatCents renders as before", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
  });

  it("toPlainDecimalString writes exponents out in full", () => {
    expect(toPlainDecimalString(1e-7)).toBe("0.0000001");
    expect(toPlainDecimalString(1.5e3)).toBe("1500");
  });
});
