import { describe, it, expect } from "vitest";
import type { Transaction, TransactionState } from "@/lib/domain/types";
import {
  canTransition,
  applyTransition,
  IllegalTransitionError,
  TRANSITIONS,
  type TransitionActor,
} from "@/lib/domain/ledger/state-machine";

const STATES: TransactionState[] = [
  "PENDING",
  "POSTED",
  "REMOVED",
  "NEEDS_REVIEW",
  "AUTO_CLASSIFIED",
  "USER_CONFIRMED",
  "EXCLUDED",
  "TRANSFER_CANDIDATE",
  "TRANSFER_CONFIRMED",
  "DUPLICATE_CANDIDATE",
  "DUPLICATE_CONFIRMED",
];

const ACTORS: TransitionActor[] = ["SYSTEM", "USER"];

/** Minimal canonical transaction for state-machine tests. */
function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_1",
    householdId: "hh_1",
    accountId: "acct_1",
    transactionDate: new Date("2026-07-01T00:00:00.000Z"),
    amountCents: -1000,
    currencyCode: "USD",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
    ...overrides,
  };
}

describe("transaction state machine — canTransition", () => {
  it("allows the system to settle a pending transaction (PENDING → POSTED)", () => {
    expect(canTransition("PENDING", "POSTED", "SYSTEM")).toBe(true);
  });

  it("allows a user to confirm a review item (NEEDS_REVIEW → USER_CONFIRMED)", () => {
    expect(canTransition("NEEDS_REVIEW", "USER_CONFIRMED", "USER")).toBe(true);
  });

  it("rejects un-settling a posted transaction (POSTED → PENDING)", () => {
    expect(canTransition("POSTED", "PENDING", "SYSTEM")).toBe(false);
  });

  it("treats REMOVED as terminal (no transitions out)", () => {
    const targets: TransactionState[] = ["POSTED", "PENDING", "NEEDS_REVIEW"];
    for (const to of targets) {
      expect(canTransition("REMOVED", to, "SYSTEM")).toBe(false);
    }
  });

  it("requires a USER actor to confirm a transfer candidate", () => {
    expect(canTransition("TRANSFER_CANDIDATE", "TRANSFER_CONFIRMED", "SYSTEM")).toBe(false);
    expect(canTransition("TRANSFER_CANDIDATE", "TRANSFER_CONFIRMED", "USER")).toBe(true);
  });

  it("requires a USER actor to confirm a duplicate candidate", () => {
    expect(canTransition("DUPLICATE_CANDIDATE", "DUPLICATE_CONFIRMED", "SYSTEM")).toBe(false);
    expect(canTransition("DUPLICATE_CANDIDATE", "DUPLICATE_CONFIRMED", "USER")).toBe(true);
  });
});

describe("transaction state machine — applyTransition", () => {
  it("returns a new transaction (immutable) and clears isPending on settlement", () => {
    const pending = txn({ state: "PENDING", isPending: true });
    const posted = applyTransition(pending, "POSTED", "SYSTEM");

    expect(posted).not.toBe(pending);
    expect(posted.state).toBe("POSTED");
    expect(posted.isPending).toBe(false);
    // input untouched
    expect(pending.state).toBe("PENDING");
    expect(pending.isPending).toBe(true);
  });

  it("marks a transaction excluded from spending when EXCLUDED by a user", () => {
    const t = txn({ state: "POSTED", isExcludedFromSpending: false });
    const excluded = applyTransition(t, "EXCLUDED", "USER");
    expect(excluded.state).toBe("EXCLUDED");
    expect(excluded.isExcludedFromSpending).toBe(true);
  });

  it("excludes a confirmed transfer from spending", () => {
    const t = txn({ state: "TRANSFER_CANDIDATE", isExcludedFromSpending: false });
    const confirmed = applyTransition(t, "TRANSFER_CONFIRMED", "USER");
    expect(confirmed.state).toBe("TRANSFER_CONFIRMED");
    expect(confirmed.isExcludedFromSpending).toBe(true);
  });

  it("throws IllegalTransitionError on an illegal transition and does not mutate input", () => {
    const removed = txn({ state: "REMOVED" });
    expect(() => applyTransition(removed, "POSTED", "SYSTEM")).toThrow(IllegalTransitionError);
    expect(removed.state).toBe("REMOVED");
  });

  it("throws when a system actor attempts a user-gated transition", () => {
    const candidate = txn({ state: "TRANSFER_CANDIDATE" });
    expect(() => applyTransition(candidate, "TRANSFER_CONFIRMED", "SYSTEM")).toThrow(
      IllegalTransitionError,
    );
  });
});

describe("state machine — flag and group derivation on user resolutions", () => {
  it("clears isExcludedFromSpending when the user confirms real activity", () => {
    const excluded = applyTransition(txn(), "EXCLUDED", "USER");
    expect(excluded.isExcludedFromSpending).toBe(true);
    const confirmed = applyTransition(excluded, "USER_CONFIRMED", "USER");
    expect(confirmed.isExcludedFromSpending).toBe(false);
  });

  it("clears duplicateGroupId when a duplicate candidate is dismissed as not-a-duplicate", () => {
    const candidate = txn({ state: "DUPLICATE_CANDIDATE", duplicateGroupId: "dup_1" });
    const dismissed = applyTransition(candidate, "POSTED", "USER");
    expect(dismissed.duplicateGroupId).toBeUndefined();
    const confirmedReal = applyTransition(
      txn({ state: "DUPLICATE_CANDIDATE", duplicateGroupId: "dup_1" }),
      "USER_CONFIRMED",
      "USER",
    );
    expect(confirmedReal.duplicateGroupId).toBeUndefined();
  });

  it("keeps duplicateGroupId when the duplicate is confirmed", () => {
    const candidate = txn({ state: "DUPLICATE_CANDIDATE", duplicateGroupId: "dup_1" });
    const confirmed = applyTransition(candidate, "DUPLICATE_CONFIRMED", "USER");
    expect(confirmed.duplicateGroupId).toBe("dup_1");
  });

  it("clears transferGroupId and the exclusion flag when a transfer candidate is confirmed as real activity", () => {
    const candidate = txn({
      state: "TRANSFER_CANDIDATE",
      transferGroupId: "xfer_1",
      isExcludedFromSpending: true,
    });
    const real = applyTransition(candidate, "USER_CONFIRMED", "USER");
    expect(real.transferGroupId).toBeUndefined();
    expect(real.isExcludedFromSpending).toBe(false);
  });
});

describe("transaction state machine — transition table coverage", () => {
  for (const from of STATES) {
    for (const [to, allowedActor] of Object.entries(TRANSITIONS[from]) as Array<[TransactionState, TransitionActor | "ANY"]>) {
      it(`allows ${allowedActor} actor for ${from} → ${to} and keeps input immutable`, () => {
        const input = txn({ state: from, isPending: from === "PENDING" });
        const before = { ...input, tagIds: [...input.tagIds] };
        const actor = allowedActor === "ANY" ? "SYSTEM" : allowedActor;

        const output = applyTransition(input, to, actor);

        expect(output.state).toBe(to);
        expect(input).toEqual(before);
      });

      if (allowedActor !== "ANY") {
        const disallowedActor: TransitionActor = allowedActor === "SYSTEM" ? "USER" : "SYSTEM";
        it(`rejects ${disallowedActor} actor for ${from} → ${to}`, () => {
          expect(() => applyTransition(txn({ state: from }), to, disallowedActor)).toThrow(IllegalTransitionError);
        });
      }
    }
  }

  for (const from of STATES) {
    for (const to of STATES) {
      if (TRANSITIONS[from][to] !== undefined) continue;

      it(`reports ${from} → ${to} as illegal for both actors when absent from the table`, () => {
        for (const actor of ACTORS) {
          expect(canTransition(from, to, actor)).toBe(false);
        }
      });
    }
  }
});
