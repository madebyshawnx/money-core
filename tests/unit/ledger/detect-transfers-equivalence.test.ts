/**
 * Equivalence and scale harness for transfer detection.
 *
 * `detectTransfers` used to copy and re-sort the entire inflow array inside its
 * per-outflow loop (O(N² log N)); it now indexes inflows by amount and whole
 * day. Transfer detection decides whether money is counted as spending, so the
 * rewrite has to be provably behaviour-identical rather than plausibly so:
 * `referenceDetectTransfers` below is a frozen, verbatim copy of the pre-index
 * algorithm (including its private helpers, which are not exported), and these
 * tests assert the two implementations agree row-for-row — same pairs, same
 * group ids, same output order — over an adversarial corpus.
 *
 * If the reference is ever "fixed" to match a behaviour change, it stops being
 * a reference. Change it only when the pairing semantics are deliberately
 * changed, and say so in the commit.
 */

import { describe, it, expect } from "vitest";
import type { Transaction, TransactionState } from "@/lib/domain/types";
import { detectAll, detectDuplicates, detectTransfers } from "@/lib/domain/ledger/detect";
import { canTransition } from "@/lib/domain/ledger/state-machine";

// ---------------------------------------------------------------------------
// Frozen reference: transfer detection exactly as it was before the index.
// ---------------------------------------------------------------------------

const TRANSFER_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRANSFER_EVIDENCE =
  /transfer|xfer|payment|pymt|autopay|zelle|venmo|cash ?app|withdraw|deposit|move to|move from/i;

function referenceDaysApart(a: Transaction, b: Transaction): number {
  return Math.abs(a.transactionDate.getTime() - b.transactionDate.getTime()) / MS_PER_DAY;
}

function referenceMayFlag(t: Transaction, candidate: TransactionState): boolean {
  if (t.replacementTransactionId != null) return false;
  return t.state === candidate || canTransition(t.state, candidate, "SYSTEM");
}

function referenceHasEvidence(t: Transaction): boolean {
  const text = `${t.merchantNormalized ?? ""} ${t.merchantRaw ?? ""} ${t.descriptionRaw ?? ""}`;
  return TRANSFER_EVIDENCE.test(text);
}

function referenceDetectTransfers(transactions: Transaction[]): Transaction[] {
  const flaggable = transactions.filter((t) => referenceMayFlag(t, "TRANSFER_CANDIDATE"));
  const outflows = flaggable.filter((t) => t.amountCents < 0);
  const inflows = flaggable.filter((t) => t.amountCents > 0);
  const used = new Set<string>();
  const pairing = new Map<string, string>();

  for (const out of outflows) {
    const match = [...inflows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .find(
        (inn) =>
          !used.has(inn.id) &&
          inn.accountId !== out.accountId &&
          inn.amountCents === -out.amountCents &&
          referenceDaysApart(out, inn) <= TRANSFER_WINDOW_DAYS &&
          (referenceHasEvidence(out) || referenceHasEvidence(inn)),
      );
    if (!match) continue;
    used.add(out.id);
    used.add(match.id);
    const groupId = `xfer_${[out.id, match.id].sort().join("_")}`;
    pairing.set(out.id, groupId);
    pairing.set(match.id, groupId);
  }

  return transactions.map((t) => {
    const groupId = pairing.get(t.id);
    if (!groupId) return t;
    return { ...t, transferGroupId: groupId, state: "TRANSFER_CANDIDATE" };
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_ZERO = Date.UTC(2026, 6, 1); // 2026-07-01T00:00:00Z

/** Date `days` (fractional allowed) after DAY_ZERO, plus an optional ms nudge. */
function at(days: number, msOffset = 0): Date {
  return new Date(DAY_ZERO + days * MS_PER_DAY + msOffset);
}

function txn(overrides: Partial<Transaction> & { id: string }): Transaction {
  return {
    householdId: "hh_1",
    accountId: "acct_checking",
    transactionDate: at(0),
    amountCents: -50000,
    currencyCode: "USD",
    merchantNormalized: "Corner Market",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
    ...overrides,
  };
}

/**
 * Everything observable about a detection run: which rows were flagged, which
 * pair they landed in (the group id encodes both member ids), and the order the
 * rows came back in.
 */
function fingerprint(transactions: Transaction[]): string[] {
  return transactions.map((t) => `${t.id}|${t.state}|${t.transferGroupId ?? "-"}`);
}

function pairedIds(transactions: Transaction[]): string[] {
  return transactions.filter((t) => t.transferGroupId !== undefined).map((t) => t.id);
}

/** Deterministic LCG — the corpus must be byte-identical on every machine and run. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ACCOUNTS = ["acct_checking", "acct_savings", "acct_card", "acct_brokerage"];
/** Deliberately tiny so amounts collide constantly — collisions are what make
 * tie-breaking and greedy consumption order observable. 2500/2501 are near-miss
 * neighbours that must never pair with each other. */
const AMOUNTS = [2500, 2501, 5000, 12345, 300000];
const EVIDENCE_TEXT = ["Online Transfer to Savings", "Zelle payment", "Autopay CARD", "ATM withdraw"];
const PLAIN_TEXT = ["Corner Market", "Acme Payroll", "Oakwood Properties", "Bluebird Coffee"];
/** Mix of flaggable and non-flaggable states so `mayFlag` filtering is exercised. */
const STATES: TransactionState[] = [
  "POSTED",
  "POSTED",
  "PENDING",
  "NEEDS_REVIEW",
  "AUTO_CLASSIFIED",
  "TRANSFER_CANDIDATE",
  "USER_CONFIRMED",
  "EXCLUDED",
  "DUPLICATE_CANDIDATE",
];
/** Times of day that straddle the day boundary, so whole-day bucketing cannot
 * stand in for the exact millisecond window check. */
const TIMES_MS = [0, 13 * 60 * 60 * 1000, MS_PER_DAY - 1, MS_PER_DAY - 60 * 1000];

/**
 * A dense, deterministic ledger: ~45 days of activity over 4 accounts drawn from
 * 5 amounts, so most rows have several equal-magnitude opposites in range.
 * Ids are unpadded (`t_9` sorts after `t_10`) so lexical id order deliberately
 * disagrees with insertion order.
 */
function buildCorpus(rowCount: number, seed = 20260805): Transaction[] {
  const rng = makeRng(seed);
  const rows: Transaction[] = [];
  for (let i = 0; i < rowCount; i++) {
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
    const magnitude = pick(AMOUNTS);
    const sign = rng() < 0.5 ? -1 : 1;
    const text = rng() < 0.45 ? pick(EVIDENCE_TEXT) : pick(PLAIN_TEXT);
    rows.push(
      txn({
        id: `t_${i}`,
        accountId: pick(ACCOUNTS),
        amountCents: sign * magnitude,
        transactionDate: at(Math.floor(rng() * 45), pick(TIMES_MS)),
        merchantNormalized: text,
        descriptionRaw: rng() < 0.15 ? "recurring deposit" : undefined,
        state: pick(STATES),
        // A linked pending→posted replacement is never flaggable.
        replacementTransactionId: rng() < 0.05 ? `t_${i}_posted` : undefined,
      }),
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Adversarial scenarios: named, hand-built, and small enough to reason about.
// ---------------------------------------------------------------------------

interface Scenario {
  /** Stable handle so the assertions below never depend on array position. */
  key: string;
  name: string;
  rows: Transaction[];
}

const SCENARIOS: readonly Scenario[] = [
  {
    key: "amount-tie",
    name: "exact amount tie — three identical inflows compete for one outflow",
    rows: [
      txn({ id: "t_9", accountId: "acct_savings", amountCents: 5000, transactionDate: at(1) }),
      txn({ id: "t_10", accountId: "acct_card", amountCents: 5000, transactionDate: at(1) }),
      txn({ id: "t_11", accountId: "acct_brokerage", amountCents: 5000, transactionDate: at(1) }),
      txn({
        id: "t_out",
        accountId: "acct_checking",
        amountCents: -5000,
        merchantNormalized: "Online Transfer to Savings",
      }),
    ],
  },
  {
    key: "same-date-tie",
    name: "same-date tie — every candidate sits on the outflow's own date",
    rows: [
      txn({ id: "t_b", accountId: "acct_savings", amountCents: 12345, merchantNormalized: "Zelle payment" }),
      txn({ id: "t_a", accountId: "acct_card", amountCents: 12345, merchantNormalized: "Zelle payment" }),
      txn({ id: "t_out", accountId: "acct_checking", amountCents: -12345 }),
    ],
  },
  {
    key: "contested-inflow",
    name: "two outflows compete for one inflow — input order decides who gets it",
    rows: [
      txn({
        id: "t_out_second",
        accountId: "acct_card",
        amountCents: -5000,
        merchantNormalized: "Autopay CARD",
      }),
      txn({
        id: "t_out_first",
        accountId: "acct_brokerage",
        amountCents: -5000,
        merchantNormalized: "Autopay CARD",
      }),
      txn({ id: "t_in", accountId: "acct_checking", amountCents: 5000 }),
    ],
  },
  {
    key: "near-miss-amount",
    name: "near-miss amount — one cent off must not pair",
    rows: [
      txn({
        id: "t_out",
        accountId: "acct_checking",
        amountCents: -2500,
        merchantNormalized: "Online Transfer to Savings",
      }),
      txn({ id: "t_in", accountId: "acct_savings", amountCents: 2501 }),
    ],
  },
  {
    key: "window-boundary",
    name: "window boundary — exactly 3 days pairs, 3 days plus 1ms does not",
    rows: [
      txn({
        id: "t_out_edge",
        accountId: "acct_checking",
        amountCents: -5000,
        transactionDate: at(0),
        merchantNormalized: "Online Transfer to Savings",
      }),
      txn({ id: "t_in_exact", accountId: "acct_savings", amountCents: 5000, transactionDate: at(3) }),
      txn({
        id: "t_out_over",
        accountId: "acct_checking",
        amountCents: -12345,
        transactionDate: at(0),
        merchantNormalized: "Online Transfer to Savings",
      }),
      txn({
        id: "t_in_over",
        accountId: "acct_savings",
        amountCents: 12345,
        transactionDate: at(3, 1),
      }),
    ],
  },
  {
    key: "no-evidence",
    name: "no transfer evidence on either side — a paycheck and rent must stay put",
    rows: [
      txn({ id: "t_pay", accountId: "acct_checking", amountCents: 300000, merchantNormalized: "Acme Payroll" }),
      txn({
        id: "t_rent",
        accountId: "acct_other",
        amountCents: -300000,
        merchantNormalized: "Oakwood Properties",
      }),
    ],
  },
  {
    key: "same-account",
    name: "opposite signs on the same account — internal, not a transfer",
    rows: [
      txn({ id: "t_a", accountId: "acct_checking", amountCents: -5000, merchantNormalized: "Zelle payment" }),
      txn({ id: "t_b", accountId: "acct_checking", amountCents: 5000, merchantNormalized: "Zelle payment" }),
    ],
  },
  {
    key: "same-sign",
    name: "same sign on different accounts — two outflows are never a pair",
    rows: [
      txn({ id: "t_c", accountId: "acct_savings", amountCents: -5000, merchantNormalized: "Zelle payment" }),
      txn({ id: "t_d", accountId: "acct_brokerage", amountCents: -5000, merchantNormalized: "Zelle payment" }),
    ],
  },
  {
    key: "non-flaggable",
    name: "non-flaggable rows — resolved states and linked replacements are skipped",
    rows: [
      txn({
        id: "t_confirmed",
        accountId: "acct_savings",
        amountCents: 5000,
        state: "USER_CONFIRMED",
        merchantNormalized: "Zelle payment",
      }),
      txn({
        id: "t_excluded",
        accountId: "acct_card",
        amountCents: 5000,
        state: "EXCLUDED",
        merchantNormalized: "Zelle payment",
      }),
      txn({
        id: "t_replaced",
        accountId: "acct_brokerage",
        amountCents: 5000,
        replacementTransactionId: "t_posted",
        merchantNormalized: "Zelle payment",
      }),
      txn({
        id: "t_open",
        accountId: "acct_savings",
        amountCents: 5000,
        transactionDate: at(2),
        merchantNormalized: "Zelle payment",
      }),
      txn({ id: "t_out", accountId: "acct_checking", amountCents: -5000 }),
    ],
  },
  {
    key: "chained-windows",
    name: "chained magnitudes — one inflow is in range of two outflows on different days",
    rows: [
      txn({
        id: "t_out_day0",
        accountId: "acct_checking",
        amountCents: -2500,
        transactionDate: at(0),
        merchantNormalized: "ATM withdraw",
      }),
      txn({
        id: "t_out_day5",
        accountId: "acct_checking",
        amountCents: -2500,
        transactionDate: at(5),
        merchantNormalized: "ATM withdraw",
      }),
      txn({ id: "t_in_day3", accountId: "acct_savings", amountCents: 2500, transactionDate: at(3) }),
      txn({ id: "t_in_day8", accountId: "acct_savings", amountCents: 2500, transactionDate: at(8) }),
    ],
  },
];

function scenarioRows(key: string): Transaction[] {
  const scenario = SCENARIOS.find((s) => s.key === key);
  if (!scenario) throw new Error(`unknown scenario ${key}`);
  return scenario.rows;
}

describe("detectTransfers — equivalence with the pre-index reference implementation", () => {
  for (const scenario of SCENARIOS) {
    it(`matches the reference: ${scenario.name}`, () => {
      expect(fingerprint(detectTransfers(scenario.rows))).toEqual(
        fingerprint(referenceDetectTransfers(scenario.rows)),
      );
    });
  }

  it("matches the reference over a 1500-row corpus with dense amount collisions", () => {
    const corpus = buildCorpus(1500);
    const actual = detectTransfers(corpus);
    expect(fingerprint(actual)).toEqual(fingerprint(referenceDetectTransfers(corpus)));
    // Guard the corpus itself: a fixture that pairs nothing would prove nothing.
    expect(pairedIds(actual).length).toBeGreaterThan(50);
  });

  it("matches the reference for every shuffle of the corpus (greedy order is preserved)", () => {
    const rng = makeRng(7);
    const base = buildCorpus(400, 424242);
    for (let round = 0; round < 8; round++) {
      const rows = shuffle(base, rng);
      expect(fingerprint(detectTransfers(rows))).toEqual(fingerprint(referenceDetectTransfers(rows)));
    }
  });

  it("matches the reference through detectAll, where duplicate flags land first", () => {
    const corpus = buildCorpus(600, 991);
    // detectAll runs duplicates first, and DUPLICATE_CANDIDATE is not a state
    // SYSTEM may relabel — so the duplicate pass changes which rows the transfer
    // pass is allowed to touch at all. This is the shape real consumers see.
    const deduped = detectDuplicates(corpus);
    expect(fingerprint(detectAll(corpus))).toEqual(fingerprint(referenceDetectTransfers(deduped)));
    expect(deduped.some((t) => t.state === "DUPLICATE_CANDIDATE")).toBe(true);
    expect(detectAll(corpus).some((t) => t.transferGroupId !== undefined)).toBe(true);
  });
});

describe("detectTransfers — pinned pairing semantics", () => {
  it("picks the lowest inflow id, not the first in input order", () => {
    const flagged = detectTransfers(scenarioRows("amount-tie"));
    // Lexical order over unpadded ids: t_10 < t_11 < t_9.
    expect(pairedIds(flagged).sort()).toEqual(["t_10", "t_out"]);
    expect(flagged.find((t) => t.id === "t_out")!.transferGroupId).toBe("xfer_t_10_t_out");
  });

  it("gives a contested inflow to the earlier outflow in input order", () => {
    const flagged = detectTransfers(scenarioRows("contested-inflow"));
    expect(pairedIds(flagged).sort()).toEqual(["t_in", "t_out_second"]);
  });

  it("pairs an exactly-3-day gap and refuses one millisecond more", () => {
    const flagged = detectTransfers(scenarioRows("window-boundary"));
    expect(pairedIds(flagged).sort()).toEqual(["t_in_exact", "t_out_edge"]);
  });

  it("leaves near-miss amounts, same-account pairs, same-sign rows and evidence-free rows alone", () => {
    for (const key of ["near-miss-amount", "same-account", "same-sign", "no-evidence"]) {
      expect(pairedIds(detectTransfers(scenarioRows(key)))).toEqual([]);
    }
  });

  it("skips rows the state machine will not let SYSTEM relabel", () => {
    const flagged = detectTransfers(scenarioRows("non-flaggable"));
    // t_confirmed / t_excluded / t_replaced all sort below t_open but are not
    // eligible, so the outflow must fall through to t_open.
    expect(pairedIds(flagged).sort()).toEqual(["t_open", "t_out"]);
  });

  it("does not mutate its input", () => {
    const rows = buildCorpus(200, 4242);
    const before = rows.map((t) => `${t.id}|${t.state}|${t.transferGroupId ?? "-"}`);
    detectTransfers(rows);
    expect(rows.map((t) => `${t.id}|${t.state}|${t.transferGroupId ?? "-"}`)).toEqual(before);
  });
});

describe("detectTransfers — scale", () => {
  /*
   * Sizing, measured on this corpus: the pre-index algorithm needs ~3100ms for
   * 10k rows (and grows quadratically from there), the indexed one ~30ms. The
   * 1500ms budget therefore leaves the current implementation roughly 50x of
   * headroom — enough that a loaded CI runner cannot flake it — while an
   * accidental return to a per-outflow sort misses it by a factor of two and
   * keeps getting worse as ledgers grow.
   */
  it("detects transfers over 10000 rows inside a 1500ms budget", () => {
    const corpus = buildCorpus(10_000, 13579);
    const started = performance.now();
    const flagged = detectTransfers(corpus);
    const elapsedMs = performance.now() - started;
    // A corpus that pairs nothing would finish fast for the wrong reason.
    expect(pairedIds(flagged).length).toBeGreaterThan(1000);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
