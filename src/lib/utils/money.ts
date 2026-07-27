/** Money is represented as integer minor units (cents) for exact math. */
export type Cents = number;

export function formatCents(cents: Cents, currency = "USD"): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
}

export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((acc, v) => acc + v, 0);
}
