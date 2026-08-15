/**
 * Data-freshness classification — the three honest states.
 *
 * The defect this pins (Cadence R0-1, ported to Money Manager as R0-18):
 * staleness was measured as `asOf - lastSuccessfulSyncAt` and reported "not
 * stale" when that field was absent — which is EVERY account either app
 * actually has, because spreadsheet and CSV imports never set a sync time. So
 * unknown was silently reported as fresh, and the fact packet asserted "All
 * connected accounts are up to date" over a dataset imported months ago.
 *
 * Unknown is not fresh. It is its own state, and it must be said out loud.
 *
 * This suite arrived with R2-14, when the module's two per-app copies (each
 * carrying its own copy of these tests) collapsed into this one. Semantics are
 * deliberately unchanged from either copy: the two apps read the same
 * household's ledger and must not disagree about what "stale" means.
 */

import { describe, expect, it } from "vitest";
import type { FactPacket, FinancialAccount } from "@/lib/domain/types";
import {
  classifyAccountFreshness,
  describeDataFreshness,
  requiresFreshnessCaveat,
  FRESH_DATA_STATUS,
  FRESHNESS_CAVEAT,
  STALE_ACCOUNT_HOURS,
} from "@/lib/domain/facts/freshness";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ASOF = new Date("2026-07-29T12:00:00.000Z");

function ago(ms: number): Date {
  return new Date(ASOF.getTime() - ms);
}

function account(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: "acct_c",
    householdId: "hh_1",
    displayName: "Checking",
    type: "CHECKING",
    currencyCode: "USD",
    includeInForecast: true,
    isDisconnected: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("classifyAccountFreshness", () => {
  it("is FRESH when the account reports a sync inside the threshold", () => {
    const inside = account({ lastSuccessfulSyncAt: ago((STALE_ACCOUNT_HOURS - 1) * HOUR_MS) });
    expect(classifyAccountFreshness(inside, ASOF)).toBe("FRESH");
  });

  it("is STALE when the account reports a sync outside the threshold", () => {
    const outside = account({ lastSuccessfulSyncAt: ago((STALE_ACCOUNT_HOURS + 1) * HOUR_MS) });
    expect(classifyAccountFreshness(outside, ASOF)).toBe("STALE");
  });

  it("is UNKNOWN — never FRESH — when the account reports no sync time at all", () => {
    // The P0. An import-sourced account carries no sync timestamp, and with
    // no dataset timestamp to fall back on nothing whatsoever is known.
    expect(classifyAccountFreshness(account(), ASOF)).toBe("UNKNOWN");
  });

  it("is STALE when the account has no sync time but the dataset itself is old", () => {
    // A dataset written 12 days ago is an UPPER BOUND on the freshness of
    // everything inside it: nothing in it can be newer than the write. So this
    // is not merely unknown — it is demonstrably stale.
    expect(classifyAccountFreshness(account(), ASOF, ago(12 * DAY_MS))).toBe("STALE");
  });

  it("stays UNKNOWN when the dataset is recent but the account's own sync age is not known", () => {
    // A fresh dataset proves when the file was written, not when the figures
    // inside it were last true, so the honest answer is still "we do not
    // know" — not "up to date".
    expect(classifyAccountFreshness(account(), ASOF, ago(2 * HOUR_MS))).toBe("UNKNOWN");
  });
});

describe("describeDataFreshness", () => {
  it("only asserts everything is up to date when every account actually proved it", () => {
    const fresh = [
      account({ id: "a", lastSuccessfulSyncAt: ago(HOUR_MS) }),
      account({ id: "b", lastSuccessfulSyncAt: ago(2 * HOUR_MS) }),
    ];
    const result = describeDataFreshness(fresh, ASOF);

    expect(result.status).toBe(FRESH_DATA_STATUS);
    expect(result.requiresCaveat).toBe(false);
    expect(result.staleCount).toBe(0);
    expect(result.unknownCount).toBe(0);
  });

  it("never emits the up-to-date sentence when any account's sync age is unknown", () => {
    const result = describeDataFreshness([account({ id: "a" }), account({ id: "b" })], ASOF, ago(HOUR_MS));

    expect(result.status).not.toBe(FRESH_DATA_STATUS);
    expect(result.status).toMatch(/unknown/i);
    expect(result.unknownCount).toBe(2);
    expect(result.requiresCaveat).toBe(true);
  });

  it("counts stale and unknown separately and says both in one sentence", () => {
    const accounts = [
      account({ id: "fresh", lastSuccessfulSyncAt: ago(HOUR_MS) }),
      account({ id: "stale", lastSuccessfulSyncAt: ago(4 * DAY_MS) }),
      account({ id: "unknown" }),
    ];
    const result = describeDataFreshness(accounts, ASOF, ago(HOUR_MS));

    expect(result.staleCount).toBe(1);
    expect(result.unknownCount).toBe(1);
    expect(result.status).toMatch(/stale/i);
    expect(result.status).toMatch(/unknown/i);
    expect(result.requiresCaveat).toBe(true);
  });

  it("reads naturally in the singular and the plural", () => {
    expect(describeDataFreshness([account({ id: "a" })], ASOF).status).toBe("Sync age is unknown for 1 account");
    expect(describeDataFreshness([account({ id: "a" }), account({ id: "b" })], ASOF).status).toBe(
      "Sync age is unknown for 2 accounts",
    );
    expect(describeDataFreshness([account({ lastSuccessfulSyncAt: ago(4 * DAY_MS) })], ASOF).status).toBe(
      "1 account has stale data",
    );
  });

  it("says nothing is stale for a household with no accounts at all", () => {
    // Nothing to be stale or unknown. Each app's own empty state is the honest
    // signal there; a stale alarm over zero accounts is its own false alarm.
    const result = describeDataFreshness([], ASOF, ago(90 * DAY_MS));

    expect(result.status).toBe(FRESH_DATA_STATUS);
    expect(result.requiresCaveat).toBe(false);
  });

  it("uses one threshold for both the reported and the inferred age", () => {
    // Same instant either side of the boundary, once via the account's own sync
    // time and once via the dataset fallback. A second threshold would show up
    // here as a disagreement between the two rows.
    const justInside = (STALE_ACCOUNT_HOURS - 1) * HOUR_MS;
    const justOutside = (STALE_ACCOUNT_HOURS + 1) * HOUR_MS;

    expect(classifyAccountFreshness(account({ lastSuccessfulSyncAt: ago(justInside) }), ASOF)).toBe("FRESH");
    expect(classifyAccountFreshness(account(), ASOF, ago(justInside))).toBe("UNKNOWN");
    expect(classifyAccountFreshness(account({ lastSuccessfulSyncAt: ago(justOutside) }), ASOF)).toBe("STALE");
    expect(classifyAccountFreshness(account(), ASOF, ago(justOutside))).toBe("STALE");
  });
});

describe("requiresFreshnessCaveat", () => {
  it("is false exactly when the packet carries the fresh-status sentinel", () => {
    expect(requiresFreshnessCaveat({ staleDataStatus: FRESH_DATA_STATUS } as FactPacket)).toBe(false);
    expect(requiresFreshnessCaveat({ staleDataStatus: "1 account has stale data" } as FactPacket)).toBe(true);
  });

  it("treats any deviation from the sentinel — even one character — as caveat-worthy", () => {
    // The sentinel used to be re-typed as a bare literal in four files per app;
    // this is the failure mode that made the module the single source of truth.
    expect(requiresFreshnessCaveat({ staleDataStatus: `${FRESH_DATA_STATUS}.` } as FactPacket)).toBe(true);
  });

  it("publishes the one caveat sentence downstream copy must carry", () => {
    // Pinned so a reword is a visible, deliberate act — both apps' AI and
    // template summarizers embed this exact string.
    expect(FRESHNESS_CAVEAT).toBe(
      "Note: some figures may be out of date; not every account has a confirmed recent sync.",
    );
  });
});
