/**
 * Money is an integer count of minor units (cents) for exact math.
 * Negative means outflow / credit. Every engine in this package assumes it.
 *
 * UPSTREAMED FROM PENNYBANK (MC-5). The previous module here was fifteen
 * lines whose `dollarsToCents` was `Math.round(dollars * 100)` — wrong for
 * values like 1.005, because the multiplication introduces representation
 * error BEFORE the rounding happens (1.005 * 100 is 100.49999999999999).
 * PennyBank's exact BigInt implementation is the stronger primitive the
 * three apps are meant to converge on, so it lives here now.
 *
 * TWO TYPES, ON PURPOSE:
 *
 *   - `Cents` stays a PLAIN `number`. The domain field types in this package
 *     (`Transaction.amountCents`, `Budget.limitCents`, …) use it, and those
 *     types flow into three consumer apps whose fixtures, importers and
 *     seeds assign raw number literals. Branding `Cents` itself would turn
 *     the next routine re-pin into an all-at-once three-app migration — the
 *     exact "half-converted codebase" failure this module's own rounding
 *     notes warn about. That migration may happen; it will be deliberate.
 *
 *   - `StrictCents` carries the compile-time brand for strong-path code. It
 *     is assignable TO `Cents` (a branded number is still a number), so
 *     strong outputs flow into domain fields seamlessly, while a plain
 *     number cannot impersonate a `StrictCents` — each `strictCents()` /
 *     `roundCents()` call is a place a reviewer must confirm the unit.
 *
 * THE ROUNDING RULE — half away from zero, applied to whole cents, at
 * exactly two boundaries:
 *
 *   1. `dollarsToCents` / `parseDollarInput` — crossing INTO cents from a
 *      decimal dollar value (user input, CSV/XLSX import, migrations).
 *   2. `roundCents` — collapsing a fractional-cent arithmetic result
 *      (interest accrual, percentage-of-balance minimums, fees) back onto
 *      the cent grid.
 *
 * Why half away from zero rather than half up or banker's rounding: it is
 * symmetric (`round(-x) === -round(x)` — `Math.round` is NOT: it maps -1.5
 * to -1), it is the ordinary commercial convention a statement reader
 * expects, and banker's rounding is surprising in per-transaction display.
 * Two documented exceptions use a directional rule because rounding the
 * wrong way there is a correctness bug, not a preference: allocating a
 * fixed budget must never spend MORE than the budget
 * (`largestRemainderSplit`), and sizing against a limit must never exceed
 * it (`floorCents`).
 */

declare const CENTS_BRAND: unique symbol;

/** Plain integer cents — the domain field type. See the header for why it is unbranded. */
export type Cents = number;

/**
 * A whole number of cents that PROVED it: produced only by the constructors
 * in this module. Assignable to `Cents`, never assignable FROM a bare number.
 */
export type StrictCents = number & { readonly [CENTS_BRAND]: void };

/** Zero, pre-branded. */
export const ZERO_CENTS = 0 as StrictCents;

/**
 * Largest magnitude representable exactly. Beyond this, integer arithmetic
 * on `number` stops being exact and the whole premise fails, so conversions
 * refuse rather than silently lose precision.
 */
export const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export function formatCents(cents: Cents, currency = "USD"): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
}

/**
 * Expand a number to its shortest round-tripping decimal string, with
 * exponential notation written out in full.
 *
 * Deliberately `String(n)` and NOT `n.toFixed(k)`: `(1.005).toFixed(20)` is
 * the exact binary value `"1.00499999999999989342"`, while `String(1.005)`
 * is `"1.005"` — the number the user typed and the text the JSON payload
 * contains. Conversion wants the user's decimal, not the binary artefact.
 */
export function toPlainDecimalString(value: number): string {
  const s = String(value);
  if (!/e/i.test(s)) return s;
  const m = /^([+-]?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return s;
  const sign = m[1] === "-" ? "-" : "";
  const intPart = m[2]!;
  const fracPart = m[3] ?? "";
  const exp = Number(m[4]);
  const digits = intPart + fracPart;
  const pointPos = intPart.length + exp;
  if (pointPos <= 0) return `${sign}0.${"0".repeat(-pointPos)}${digits}`;
  if (pointPos >= digits.length) {
    return `${sign}${digits}${"0".repeat(pointPos - digits.length)}`;
  }
  return `${sign}${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
}

/**
 * Decimal STRING of dollars to whole cents, half away from zero. BigInt for
 * the digit arithmetic so no intermediate step can lose precision; `null`
 * when the string is not a plain decimal or the result is not safe.
 */
function decimalStringToCents(text: string): StrictCents | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") return null;
  const negative = m[1] === "-";

  const whole = BigInt(intPart === "" ? "0" : intPart);
  const keptFrac = fracPart.slice(0, 2).padEnd(2, "0");
  let magnitude = whole * 100n + BigInt(keptFrac);

  // Working on the magnitude, so "round up" always means "away from zero".
  const remainder = fracPart.slice(2);
  if (remainder.length > 0 && remainder.charCodeAt(0) >= 0x35 /* '5' */) {
    magnitude += 1n;
  }

  const signed = negative ? -magnitude : magnitude;
  if (signed > BigInt(MAX_CENTS) || signed < BigInt(-MAX_CENTS)) return null;
  const result = Number(signed);
  return (result === 0 ? 0 : result) as StrictCents;
}

/**
 * Convert a dollar amount to whole cents. Returns `null` when the value
 * cannot be represented — non-finite, or larger than `MAX_CENTS` once
 * scaled. More than two decimal places is ROUNDED (half away from zero),
 * not rejected: real payloads contain values like a 3%-of-balance minimum
 * on $1,753.08 being $52.5924.
 *
 * Do NOT replace this with `Math.round(dollars * 100)`:
 *
 *     Math.round(1.005 * 100) === 100    // 1.005 * 100 is 100.49999999999999
 *     dollarsToCents(1.005)   === 101
 */
export function dollarsToCents(dollars: number): StrictCents | null {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return null;
  return decimalStringToCents(toPlainDecimalString(dollars));
}

/**
 * Parse a money value a human typed. Tolerates a leading currency symbol,
 * thousands separators and whitespace. `null` means "not a number" and must
 * be treated as a validation failure, never as zero.
 */
export function parseDollarInput(input: string): StrictCents | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+" || cleaned === ".") return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  return decimalStringToCents(cleaned);
}

/** Cents back to dollars. The single division on the display path. */
export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

/**
 * Brand a value that is ALREADY a whole number of cents — the result of
 * adding, subtracting or min/max-ing existing cents. Use `roundCents`
 * whenever a multiplication or division was involved.
 */
export function strictCents(value: number): StrictCents {
  return (value === 0 ? 0 : value) as StrictCents;
}

/**
 * The rounding boundary: fractional cents → whole cents, half away from
 * zero. `null` for non-finite input rather than branding it — a NaN wearing
 * the brand is a landmine for every consumer that trusts the type.
 */
export function roundCents(value: number): StrictCents | null {
  if (!Number.isFinite(value)) return null;
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return (rounded === 0 ? 0 : rounded) as StrictCents;
}

/** Toward negative infinity. Use where overshooting is a correctness bug. */
export function floorCents(value: number): StrictCents | null {
  if (!Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return (floored === 0 ? 0 : floored) as StrictCents;
}

/** Toward positive infinity. Use where undershooting is a correctness bug. */
export function ceilCents(value: number): StrictCents | null {
  if (!Number.isFinite(value)) return null;
  const ceiled = Math.ceil(value);
  return (ceiled === 0 ? 0 : ceiled) as StrictCents;
}

/** Exact sum. No tolerance, no drift — this is why the package uses cents. */
export function sumCents(values: readonly Cents[]): StrictCents {
  let total = 0;
  for (const v of values) total += v;
  return strictCents(total);
}

/** `Math.min` over cents, keeping the brand. */
export function minCents(a: StrictCents, b: StrictCents): StrictCents {
  return a < b ? a : b;
}

/** `Math.max` over cents, keeping the brand. */
export function maxCents(a: StrictCents, b: StrictCents): StrictCents {
  return a > b ? a : b;
}

/** Clamp to `[min, max]`, keeping the brand. */
export function clampCents(value: StrictCents, min: StrictCents, max: StrictCents): StrictCents {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Split `total` cents across `weights` proportionally, distributing every
 * remaining cent by the largest-remainder method so the parts sum to
 * EXACTLY `total`. Rounding each share independently would either overspend
 * the total (`roundCents`) or silently strand up to n-1 cents (`floorCents`)
 * — over a 600-month projection that is a visible discrepancy. Largest
 * remainder keeps the invariant exact.
 */
export function largestRemainderSplit(total: StrictCents, weights: readonly number[]): StrictCents[] {
  const n = weights.length;
  if (n === 0) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) return weights.map(() => ZERO_CENTS);

  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map((x) => Math.floor(x));
  let allocated = floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = floors.slice();
  let cursor = 0;
  while (allocated < total && cursor < order.length) {
    result[order[cursor]!.i]! += 1;
    allocated += 1;
    cursor += 1;
  }
  return result.map(strictCents);
}
