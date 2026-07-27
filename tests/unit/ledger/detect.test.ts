import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/domain/types";
import { detectDuplicates, detectTransfers } from "@/lib/domain/ledger/detect";
import { getPrimaryDataset } from "@/lib/seed/scenarios";

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-05T00:00:00.000Z"),
    amountCents: -28900,
    currencyCode: "USD",
    merchantNormalized: "Harbor Grand Hotel",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
    ...overrides,
  };
}

describe("ledger detect — duplicates", () => {
  it("flags two same-account, same-amount, same-merchant rows within the window as DUPLICATE_CANDIDATE", () => {
    const hold = txn({ id: "hold", isPending: true, state: "PENDING" });
    const charge = txn({ id: "charge", isPending: false, state: "POSTED" });
    const dedup = detectDuplicates([hold, charge]);
    const a = byId(dedup, "hold");
    const b = byId(dedup, "charge");
    expect(a.state).toBe("DUPLICATE_CANDIDATE");
    expect(b.state).toBe("DUPLICATE_CANDIDATE");
    expect(a.duplicateGroupId).toBeDefined();
    expect(a.duplicateGroupId).toBe(b.duplicateGroupId);
  });

  it("does not flag a pending→posted replacement (linked, different amount) as a duplicate", () => {
    const pending = txn({
      id: "pending",
      amountCents: -4200,
      state: "PENDING",
      isPending: true,
      merchantNormalized: "Osteria Verde",
      replacementTransactionId: "posted",
    });
    const posted = txn({
      id: "posted",
      amountCents: -4956,
      state: "POSTED",
      merchantNormalized: "Osteria Verde",
    });
    const out = detectDuplicates([pending, posted]);
    expect(out.every((t) => t.duplicateGroupId === undefined)).toBe(true);
  });

  it("does not flag same-amount rows on different accounts", () => {
    const a = txn({ id: "a", accountId: "acct_1" });
    const b = txn({ id: "b", accountId: "acct_2" });
    const out = detectDuplicates([a, b]);
    expect(out.every((t) => t.duplicateGroupId === undefined)).toBe(true);
  });

  it("leaves an unmatched single transaction untouched", () => {
    const out = detectDuplicates([txn({ id: "solo" })]);
    expect(out[0]!.state).toBe("POSTED");
    expect(out[0]!.duplicateGroupId).toBeUndefined();
  });

  it("re-discovers the seed Harbor Grand duplicate group from unflagged rows", () => {
    const { transactions } = getPrimaryDataset();
    const raw = transactions
      .filter((t) => t.duplicateGroupId === "grp_rivera_hotel")
      .map((t) => ({
        ...t,
        duplicateGroupId: undefined,
        state: t.isPending ? ("PENDING" as const) : ("POSTED" as const),
      }));
    expect(raw).toHaveLength(2);
    const out = detectDuplicates(raw);
    expect(out.every((t) => t.state === "DUPLICATE_CANDIDATE")).toBe(true);
    expect(out[0]!.duplicateGroupId).toBe(out[1]!.duplicateGroupId);
  });
});

describe("ledger detect — transfers", () => {
  it("flags an equal-magnitude outflow/inflow across two accounts as TRANSFER_CANDIDATE", () => {
    const out = txn({
      id: "out",
      accountId: "acct_checking",
      amountCents: -50000,
      merchantNormalized: "Transfer",
    });
    const inn = txn({
      id: "in",
      accountId: "acct_savings",
      amountCents: 50000,
      merchantNormalized: "Transfer",
      transactionDate: new Date("2026-07-06T00:00:00.000Z"),
    });
    const flagged = detectTransfers([out, inn]);
    const a = byId(flagged, "out");
    const b = byId(flagged, "in");
    expect(a.state).toBe("TRANSFER_CANDIDATE");
    expect(b.state).toBe("TRANSFER_CANDIDATE");
    expect(a.transferGroupId).toBeDefined();
    expect(a.transferGroupId).toBe(b.transferGroupId);
  });

  it("does not flag two outflows (same sign) as a transfer", () => {
    const a = txn({ id: "a", accountId: "acct_1", amountCents: -50000 });
    const b = txn({ id: "b", accountId: "acct_2", amountCents: -50000 });
    const out = detectTransfers([a, b]);
    expect(out.every((t) => t.transferGroupId === undefined)).toBe(true);
  });

  it("does not flag an opposite pair on the same account as a transfer", () => {
    const a = txn({ id: "a", accountId: "acct_1", amountCents: -50000 });
    const b = txn({ id: "b", accountId: "acct_1", amountCents: 50000 });
    const out = detectTransfers([a, b]);
    expect(out.every((t) => t.transferGroupId === undefined)).toBe(true);
  });

  it("returns new objects and does not mutate inputs", () => {
    const hold = txn({ id: "hold", isPending: true, state: "PENDING" });
    const charge = txn({ id: "charge" });
    const inputStates = [hold.state, charge.state];
    detectDuplicates([hold, charge]);
    expect([hold.state, charge.state]).toEqual(inputStates);
  });
});

/** Find a transaction by id, throwing if it is missing (returns a non-optional row). */
function byId(transactions: Transaction[], id: string): Transaction {
  const found = transactions.find((t) => t.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("detection — state-machine legality, order independence, transfer evidence", () => {
  it("never relabels a transfer candidate as a duplicate candidate (illegal transition)", () => {
    const a = txn({ id: "t_a", state: "TRANSFER_CANDIDATE", transferGroupId: "xfer_1" });
    const b = txn({
      id: "t_b",
      state: "TRANSFER_CANDIDATE",
      transferGroupId: "xfer_1",
      transactionDate: new Date("2026-07-06T00:00:00.000Z"),
    });
    const result = detectDuplicates([a, b]);
    expect(result.every((t) => t.state === "TRANSFER_CANDIDATE")).toBe(true);
  });

  it("flags the same duplicate set regardless of input order", () => {
    const mk = (id: string, day: string) =>
      txn({ id, transactionDate: new Date(`2026-07-0${day}T00:00:00.000Z`) });
    const orderA = detectDuplicates([mk("t_1", "1"), mk("t_3", "3"), mk("t_5", "5")]);
    const orderB = detectDuplicates([mk("t_3", "3"), mk("t_1", "1"), mk("t_5", "5")]);
    const flaggedA = orderA.filter((t) => t.state === "DUPLICATE_CANDIDATE").map((t) => t.id).sort();
    const flaggedB = orderB.filter((t) => t.state === "DUPLICATE_CANDIDATE").map((t) => t.id).sort();
    expect(flaggedA).toEqual(flaggedB);
  });

  it("does not flag a paycheck and rent of equal magnitude as a transfer (no transfer evidence)", () => {
    const paycheck = txn({
      id: "t_pay",
      accountId: "acct_checking",
      amountCents: 300000,
      merchantNormalized: "Acme Payroll",
    });
    const rent = txn({
      id: "t_rent",
      accountId: "acct_other",
      amountCents: -300000,
      merchantNormalized: "Oakwood Properties",
    });
    const result = detectTransfers([paycheck, rent]);
    expect(result.every((t) => t.state === "POSTED")).toBe(true);
  });

  it("still flags a keyword-evidenced transfer pair", () => {
    const out = txn({
      id: "t_out",
      accountId: "acct_checking",
      amountCents: -50000,
      merchantNormalized: "Online Transfer to Savings",
    });
    const inn = txn({
      id: "t_in",
      accountId: "acct_savings",
      amountCents: 50000,
      merchantNormalized: "Online Transfer from Checking",
    });
    const result = detectTransfers([out, inn]);
    expect(result.every((t) => t.state === "TRANSFER_CANDIDATE")).toBe(true);
  });
});
