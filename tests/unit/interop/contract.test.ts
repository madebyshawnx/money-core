/**
 * The interop bundle CONTRACT (R2-15) — one definition, validated on both
 * boundaries.
 *
 * The bundle's DTO types used to exist as hand-maintained MIRROR types in the
 * two apps, and they drifted twice before anything noticed: the consumer's
 * copy silently dropped `recurringObligations[].categoryId` (AUD-3 F1), and
 * disagreed with the producer about `amountCents` optionality. The cross-repo
 * byte-pinned fixture could not see either — bytes prove what the producer
 * sends, not what a consumer's types can receive.
 *
 * This suite is the contract's own conformance matrix, run against fixtures
 * COMMITTED HERE (a sibling-tree check cannot protect the package in isolated
 * CI). The golden fixture is byte-identical to the producer's
 * (`money-manager/tests/fixtures/interop-bundle-v3.json`, itself asserted
 * against the live exporter).
 *
 * Date policy, inherited from the consumer's #34 hardening and now owned by
 * the contract: REQUIRED dates (`exportedAt`, `transactionDate`,
 * `capturedAt`) refuse the bundle; OPTIONAL dates degrade to `undefined` WITH
 * a warning; only ISO-ish strings parse — `new Date(0)`, `new Date(null)` and
 * `new Date(false)` all coerce to a valid 1970 epoch, so a type-corrupted
 * field must never reach `new Date` unchecked.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  INTEROP_VERSION,
  parseInteropBundleText,
  serializeInteropBundle,
  validateInteropBundle,
  type InteropBundle,
} from "@/lib/interop";

const FIXTURE = resolve(__dirname, "../../fixtures/interop-bundle-v3.json");

function fixtureText(): string {
  return readFileSync(FIXTURE, "utf8");
}

/** Parse → mutate → restringify, so corruption still enters as TEXT. */
function corrupted(mutate: (wire: any) => void): string {
  const wire = JSON.parse(fixtureText());
  mutate(wire);
  return JSON.stringify(wire);
}

function goldenBundle(): InteropBundle {
  const result = parseInteropBundleText(fixtureText());
  if (!result.ok) throw new Error(`golden fixture must parse: ${JSON.stringify(result)}`);
  return result.bundle;
}

function issuePaths(result: { ok: boolean }): string[] {
  return result.ok === false ? (result as any).issues.map((i: any) => i.path) : [];
}

describe("parseInteropBundleText — acceptance", () => {
  it("accepts the committed golden fixture and revives its dates", () => {
    const result = parseInteropBundleText(fixtureText());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.interopVersion).toBe(INTEROP_VERSION);
    expect(result.bundle.provider).toBe("MONEY_MANAGER");
    expect(result.bundle.accounts.length).toBeGreaterThan(0);
    expect(result.bundle.transactions.length).toBe(10);
    expect(result.bundle.recurringObligations.length).toBe(6);
    expect(result.bundle.exportedAt).toBeInstanceOf(Date);
    expect(result.bundle.transactions[0]!.transactionDate).toBeInstanceOf(Date);
    expect(result.warnings).toEqual([]);
  });

  it("keeps recurring categoryId — the field the consumer's mirror type dropped", () => {
    const text = corrupted((wire) => {
      wire.recurringObligations[0].categoryId = "cat_rivera_subscriptions";
    });
    const result = parseInteropBundleText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.recurringObligations[0]!.categoryId).toBe("cat_rivera_subscriptions");
  });

  it("requires recurring amountCents and accepts null for it — the exact v3 semantics", () => {
    const missing = parseInteropBundleText(
      corrupted((wire) => {
        delete wire.recurringObligations[0].amountCents;
      }),
    );
    expect(missing.ok).toBe(false);
    expect(issuePaths(missing)).toContain("recurringObligations[0].amountCents");

    const nullAmount = parseInteropBundleText(
      corrupted((wire) => {
        wire.recurringObligations[0].amountCents = null;
      }),
    );
    expect(nullAmount.ok).toBe(true);
    if (!nullAmount.ok) return;
    expect(nullAmount.bundle.recurringObligations[0]!.amountCents).toBeNull();
  });
});

describe("parseInteropBundleText — failure classes", () => {
  it("classifies unparseable text as invalid_json", () => {
    const result = parseInteropBundleText("definitely not json{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_json");
  });

  it("classifies a non-object root as invalid_bundle", () => {
    for (const text of ["[]", "42", '"hello"', "null"]) {
      const result = parseInteropBundleText(text);
      expect(result.ok, text).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe("invalid_bundle");
    }
  });

  it("distinguishes unsupported_version from corruption, even when the body would not validate", () => {
    // A v4 bundle with a shape this version has never seen must still diagnose
    // as "upgrade required", not "corrupt export" — the version check runs
    // before structural validation.
    const future = parseInteropBundleText(
      JSON.stringify({ interopVersion: INTEROP_VERSION + 1, someFutureShape: true }),
    );
    expect(future.ok).toBe(false);
    if (future.ok) return;
    expect(future.code).toBe("unsupported_version");
    if (future.code !== "unsupported_version") return;
    expect(future.actualVersion).toBe(INTEROP_VERSION + 1);
    expect(future.supportedVersion).toBe(INTEROP_VERSION);

    const old = parseInteropBundleText(corrupted((wire) => (wire.interopVersion = 2)));
    expect(old.ok).toBe(false);
    if (old.ok) return;
    expect(old.code).toBe("unsupported_version");

    // A MISSING or non-numeric version cannot diagnose an upgrade path — that
    // is corruption, not a version skew.
    const missing = parseInteropBundleText(corrupted((wire) => delete wire.interopVersion));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe("invalid_bundle");
  });

  it("rejects a wrong provider literal", () => {
    const result = parseInteropBundleText(corrupted((wire) => (wire.provider = "SOMEONE_ELSE")));
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain("provider");
  });

  it("rejects unknown properties at the root and inside rows — drift fails loudly", () => {
    const root = parseInteropBundleText(corrupted((wire) => (wire.surprise = 1)));
    expect(root.ok).toBe(false);
    expect(issuePaths(root)).toContain("surprise");

    const nested = parseInteropBundleText(
      corrupted((wire) => (wire.accounts[0].bogusField = "x")),
    );
    expect(nested.ok).toBe(false);
    expect(issuePaths(nested)).toContain("accounts[0].bogusField");
  });

  it("rejects enum drift", () => {
    const badType = parseInteropBundleText(
      corrupted((wire) => (wire.accounts[0].type = "PIGGYBANK")),
    );
    expect(issuePaths(badType)).toContain("accounts[0].type");

    const badFreq = parseInteropBundleText(
      corrupted((wire) => (wire.recurringObligations[0].frequency = "FORTNIGHTLY")),
    );
    expect(issuePaths(badFreq)).toContain("recurringObligations[0].frequency");
  });

  it("rejects sparse array slots instead of validating past them", () => {
    // `new Array(1)` has length 1 and no elements. forEach/map skip the hole,
    // so an unguarded walker would validate it as fine and then SERIALIZE it
    // as [null] — bytes the package's own parser refuses.
    const sparse = parseInteropBundleText(
      corrupted((wire) => (wire.accounts = new Array(1))),
    );
    expect(sparse.ok).toBe(false);
    expect(issuePaths(sparse)).toContain("accounts[0]");

    const bundle = goldenBundle();
    const holed: InteropBundle = { ...bundle, accounts: new Array(2) as never };
    const serialized = serializeInteropBundle(holed);
    expect(serialized.ok).toBe(false);
  });

  it("rejects non-ISO date strings, including the ones new Date() would happily coerce", () => {
    // "0" parses as 2000-01-01 in Node; "08/15/2026" is locale/engine
    // dependent. The wire contract is toISOString output — nothing else.
    for (const value of ["0", "08/15/2026", "August 15 2026", "1755219600000"]) {
      const result = parseInteropBundleText(corrupted((wire) => (wire.exportedAt = value)));
      expect(result.ok, `exportedAt=${value}`).toBe(false);
    }
    // The two shapes the producer actually writes stay accepted, plus a leap
    // day that really exists and an explicit offset.
    for (const value of [
      "2026-08-15T12:00:00.000Z",
      "2026-08-15",
      "2024-02-29",
      "2026-08-15T12:00:00+05:30",
    ]) {
      const result = parseInteropBundleText(corrupted((wire) => (wire.exportedAt = value)));
      expect(result.ok, `exportedAt=${value}`).toBe(true);
    }
  });

  it("rejects impossible calendar dates instead of letting new Date() normalize them", () => {
    // Node silently rolls these forward: 2026-02-29 → March 1, 2026-04-31 →
    // May 1. Corrupt wire data becoming a DIFFERENT valid date with no issue
    // is exactly the silent-coercion class this validator exists to stop.
    for (const value of [
      "2026-02-29", // 2026 is not a leap year
      "2026-02-30",
      "2026-04-31",
      "2026-02-30T12:00:00Z",
      "2026-08-15T24:00:00Z", // hour 24 is engine-dependent, not contract
    ]) {
      const result = parseInteropBundleText(corrupted((wire) => (wire.exportedAt = value)));
      expect(result.ok, `exportedAt=${value}`).toBe(false);
    }
  });

  it("rejects cents beyond Number.MAX_SAFE_INTEGER — JSON already rounded them", () => {
    const result = parseInteropBundleText(
      corrupted((wire) => (wire.transactions[0].amountCents = 9007199254740993)),
    );
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain("transactions[0].amountCents");
  });

  it("rejects non-integer and non-numeric cents", () => {
    const fractional = parseInteropBundleText(
      corrupted((wire) => (wire.transactions[0].amountCents = 12.5)),
    );
    expect(issuePaths(fractional)).toContain("transactions[0].amountCents");

    const stringCents = parseInteropBundleText(
      corrupted((wire) => (wire.transactions[0].amountCents = "100")),
    );
    expect(issuePaths(stringCents)).toContain("transactions[0].amountCents");

    const fractionalBalance = parseInteropBundleText(
      corrupted((wire) => (wire.balances[0].currentCents = 0.5)),
    );
    expect(issuePaths(fractionalBalance)).toContain("balances[0].currentCents");
  });
});

describe("parseInteropBundleText — the date policy", () => {
  it("refuses the bundle when a REQUIRED date is corrupt, for every corruption class", () => {
    const corruptions: Array<[string, (wire: any) => void]> = [
      ["exportedAt garbage", (w) => (w.exportedAt = "not-a-date")],
      ["exportedAt null", (w) => (w.exportedAt = null)],
      ["exportedAt epoch-coercing 0", (w) => (w.exportedAt = 0)],
      ["exportedAt epoch-coercing false", (w) => (w.exportedAt = false)],
      ["exportedAt missing", (w) => delete w.exportedAt],
      ["transactionDate garbage", (w) => (w.transactions[0].transactionDate = "garbage")],
      ["capturedAt epoch-coercing 0", (w) => (w.balances[0].capturedAt = 0)],
    ];
    for (const [label, mutate] of corruptions) {
      const result = parseInteropBundleText(corrupted(mutate));
      expect(result.ok, label).toBe(false);
    }
  });

  it("degrades a corrupt OPTIONAL date to undefined and says so in warnings", () => {
    const corruptions: Array<[string, (wire: any) => void, (b: InteropBundle) => unknown]> = [
      [
        "accounts[0].lastSuccessfulSyncAt",
        (w) => (w.accounts[0].lastSuccessfulSyncAt = "garbage"),
        (b) => b.accounts[0]!.lastSuccessfulSyncAt,
      ],
      [
        "accounts[0].lastSuccessfulSyncAt",
        (w) => (w.accounts[0].lastSuccessfulSyncAt = false),
        (b) => b.accounts[0]!.lastSuccessfulSyncAt,
      ],
      [
        "transactions[0].postedAt",
        (w) => (w.transactions[0].postedAt = 0),
        (b) => b.transactions[0]!.postedAt,
      ],
      [
        "recurringObligations[0].nextExpectedDate",
        (w) => (w.recurringObligations[0].nextExpectedDate = "garbage"),
        (b) => b.recurringObligations[0]!.nextExpectedDate,
      ],
    ];
    for (const [path, mutate, read] of corruptions) {
      const result = parseInteropBundleText(corrupted(mutate));
      expect(result.ok, path).toBe(true);
      if (!result.ok) continue;
      expect(read(result.bundle), path).toBeUndefined();
      expect(result.warnings.map((w) => w.path), path).toContain(path);
    }
  });
});

describe("serializeInteropBundle — the canonical producer", () => {
  it("round-trips the golden fixture BYTE-IDENTICALLY", () => {
    // The strongest statement the contract can make: parsing the producer's
    // real bytes and re-serializing them reproduces those bytes exactly —
    // canonical field order, 2-space indent, ISO dates, trailing newline.
    const result = serializeInteropBundle(goldenBundle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.replace(/\r\n/g, "\n")).toBe(fixtureText().replace(/\r\n/g, "\n"));
    // The serializer's own bytes are strictly canonical: LF only, exactly one
    // trailing newline (the CRLF normalization above tolerates the FIXTURE's
    // checkout state, never the serializer's output).
    expect(result.text).not.toContain("\r");
    expect(result.text.endsWith("\n")).toBe(true);
    expect(result.text.endsWith("\n\n")).toBe(false);
  });

  it("refuses to emit an invalid bundle instead of serializing corruption", () => {
    const bundle = goldenBundle();
    const corrupt: InteropBundle = { ...bundle, exportedAt: new Date("garbage") };
    const result = serializeInteropBundle(corrupt);
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain("exportedAt");
  });

  it("refuses an invalid OPTIONAL date too — the producer must not emit known corruption", () => {
    const bundle = goldenBundle();
    const corrupt: InteropBundle = {
      ...bundle,
      recurringObligations: bundle.recurringObligations.map((o, i) =>
        i === 0 ? { ...o, nextExpectedDate: new Date("garbage") } : o,
      ),
    };
    const result = serializeInteropBundle(corrupt);
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain("recurringObligations[0].nextExpectedDate");
  });
});

describe("validateInteropBundle — in-memory producer check", () => {
  it("passes the revived golden bundle", () => {
    const result = validateInteropBundle(goldenBundle());
    expect(result.ok).toBe(true);
  });

  it("catches a missing required field with a stable path", () => {
    const bundle = goldenBundle() as any;
    delete bundle.householdId;
    const result = validateInteropBundle(bundle);
    expect(result.ok).toBe(false);
    expect(issuePaths(result)).toContain("householdId");
  });
});

/**
 * Supplemental only: when the producer's working tree is present, its copy of
 * the golden fixture must be byte-identical to ours (CRLF-normalized). The
 * COMMITTED fixture above is the contract's authority; this just catches the
 * two drifting apart on a machine that has both repos.
 */
describe.skipIf(!existsSync("C:/dev/money-manager"))("sibling fixture identity", () => {
  it("matches Money Manager's golden fixture byte-for-byte", () => {
    const sibling = readFileSync(
      join("C:/dev/money-manager", "tests/fixtures/interop-bundle-v3.json"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(fixtureText().replace(/\r\n/g, "\n")).toBe(sibling);
  });
});
