/**
 * Data freshness — how old the figures underneath a surface are, and the one
 * sentence that says so.
 *
 * Both apps' product rules (CLAUDE.md build principle #5) require confidence,
 * stale-data and missing-data warnings to be shown clearly. That promise has
 * three possible answers, not two:
 *
 *   FRESH    the account reported a successful sync inside the threshold.
 *   STALE    the newest evidence available is older than the threshold.
 *   UNKNOWN  no evidence establishes when this account was last current.
 *
 * UNKNOWN USED TO BE REPORTED AS FRESH, in both apps. Staleness was measured as
 * `asOf - lastSuccessfulSyncAt` and returned "not stale" when that field was
 * absent — which is EVERY account these products actually have, because
 * spreadsheet and CSV imports never set a sync time. So the packet asserted
 * "All connected accounts are up to date" while the surface beside it truthfully
 * said "Updated 12 days ago", and no AI caveat could fire. Silence about an
 * unknown is indistinguishable from a claim of freshness, and on this product
 * that is the one thing it must never be. Fixed in Cadence as R0-1, ported to
 * Money Manager as R0-18.
 *
 * THIS MODULE IS THE SINGLE SOURCE OF TRUTH for both the threshold and the
 * fresh-status sentinel. The sentinel was previously re-typed as a bare string
 * literal in four files PER APP, each comparing against its own copy — a
 * one-character edit in one of them would have silently disabled staleness in
 * the others, with nothing failing to say so. The module itself then existed as
 * two per-app copies, collapsed into this one with R2-14: the two apps read the
 * same household's ledger and must not disagree about what "stale" means.
 *
 * The only thing that differs per app is what supplies `dataUpdatedAt` — the
 * interop bundle's `exportedAt` in Cadence, the environment's import date in
 * Money Manager.
 *
 * Pure and deterministic: the caller supplies `asOf`; no clock, no RNG.
 */

import type { FactPacket, FinancialAccount } from "@/lib/domain/types";

/**
 * A connected account with no successful sync within this many hours is stale.
 *
 * ONE threshold, used for both the age an account reports itself and the age
 * inferred from the dataset's own timestamp. A second threshold for the
 * inferred case would let the same instant read fresh by one measure and stale
 * by the other.
 */
export const STALE_ACCOUNT_HOURS = 18;

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * The only sentence that means "we checked every connected account, and they are
 * all current". Import it; never re-type it. Everything downstream treats any
 * other value as a reason to caveat, so this string is load-bearing.
 */
export const FRESH_DATA_STATUS = "All connected accounts are up to date";

/**
 * The one caveat sentence a summary must carry when freshness is not
 * established, covering both reasons it can be required.
 *
 * "not every account has a confirmed recent sync" is true whether an account
 * reported a sync that is too old (STALE) or reported none at all (UNKNOWN).
 * The previous wording named stale data specifically, which would have been an
 * invented explanation in the second case — the more common one. It lives here,
 * beside the states it describes, so the caveat and the classification cannot
 * drift apart.
 */
export const FRESHNESS_CAVEAT =
  "Note: some figures may be out of date; not every account has a confirmed recent sync.";

export type AccountFreshness = "FRESH" | "STALE" | "UNKNOWN";

export interface DataFreshness {
  /** The sentence the packet publishes as `staleDataStatus`. */
  status: string;
  staleCount: number;
  unknownCount: number;
  /** True whenever copy derived from this data — template or model — must carry a caveat. */
  requiresCaveat: boolean;
}

/**
 * Classify one account against `asOf`.
 *
 * `dataUpdatedAt` is when the dataset itself was last written. It is a genuine
 * UPPER BOUND on the freshness of everything inside it: nothing in a dataset
 * written 12 days ago can be newer than 12 days, so an old dataset makes an
 * account with no sync time demonstrably STALE rather than merely unknown.
 *
 * The converse does not hold, and that asymmetry is the point: a recent
 * `dataUpdatedAt` proves when the file was written, not when the figures inside
 * it were last true. A household that exports its budget monthly and imports it
 * today is handing over month-old numbers. So a fresh `dataUpdatedAt` leaves an
 * account with no sync time at UNKNOWN. It never promotes it to FRESH.
 */
export function classifyAccountFreshness(
  account: FinancialAccount,
  asOf: Date,
  dataUpdatedAt?: Date,
): AccountFreshness {
  const reportedAt = account.lastSuccessfulSyncAt;
  const observedAt = reportedAt ?? dataUpdatedAt;
  if (!observedAt) return "UNKNOWN";
  if (asOf.getTime() - observedAt.getTime() > STALE_ACCOUNT_HOURS * MS_PER_HOUR) return "STALE";
  return reportedAt ? "FRESH" : "UNKNOWN";
}

/**
 * Describe the freshness of a set of connected accounts.
 *
 * `FRESH_DATA_STATUS` is returned only when nothing is stale and nothing is
 * unknown — the assertion is emitted when it has been established, and not
 * otherwise.
 *
 * NOTE on the empty case: with no connected accounts there is nothing to be
 * stale or unknown, and the packet's `accountCoverage` ("0 of 0 accounts
 * connected") — or the app's blank-first empty state — is the honest signal for
 * that situation. Reporting an empty household as stale would be its own false
 * alarm, so this returns the fresh sentence vacuously.
 */
export function describeDataFreshness(
  connectedAccounts: FinancialAccount[],
  asOf: Date,
  dataUpdatedAt?: Date,
): DataFreshness {
  let staleCount = 0;
  let unknownCount = 0;
  for (const account of connectedAccounts) {
    const freshness = classifyAccountFreshness(account, asOf, dataUpdatedAt);
    if (freshness === "STALE") staleCount += 1;
    else if (freshness === "UNKNOWN") unknownCount += 1;
  }

  return {
    status: freshnessSentence(staleCount, unknownCount),
    staleCount,
    unknownCount,
    requiresCaveat: staleCount > 0 || unknownCount > 0,
  };
}

/**
 * Whether this packet's data obliges the summary to carry a caveat.
 *
 * The one predicate the template summarizer, the briefing assembler and the AI
 * summarizer all consult, so they cannot drift apart.
 */
export function requiresFreshnessCaveat(packet: FactPacket): boolean {
  return packet.staleDataStatus !== FRESH_DATA_STATUS;
}

function freshnessSentence(staleCount: number, unknownCount: number): string {
  if (staleCount > 0 && unknownCount > 0) {
    return `${stalePhrase(staleCount)}, and sync age is unknown for ${accountCount(unknownCount)}`;
  }
  if (staleCount > 0) return stalePhrase(staleCount);
  if (unknownCount > 0) return `Sync age is unknown for ${accountCount(unknownCount)}`;
  return FRESH_DATA_STATUS;
}

function stalePhrase(count: number): string {
  return `${count} ${count === 1 ? "account has" : "accounts have"} stale data`;
}

function accountCount(count: number): string {
  return `${count} ${count === 1 ? "account" : "accounts"}`;
}
