/**
 * Duplicate and transfer candidate detection.
 *
 * These are the two detection stages downstream of the state engine (docs/24
 * diagram, box K "Transfer and Duplicate Detection"). The docs enumerate the
 * required scenarios (docs/17: "card payment transfer … account-to-account
 * transfer"; docs/34 scenario 4 "Duplicate-looking hotel authorization hold")
 * but not the algorithm — so these heuristics are designed to the fixtures.
 *
 * Detection only ever proposes CANDIDATES (never confirms): confirmation is
 * user-gated (see state-machine.ts). Both functions are pure and deterministic —
 * group ids are derived from stable transaction attributes, not a clock or RNG —
 * and return new transaction objects without mutating their inputs.
 */

import type { Transaction, TransactionState } from "@/lib/domain/types";
import { canTransition } from "./state-machine";

/** Max whole-day gap for two rows to be considered the same duplicate/transfer event. */
const DUPLICATE_WINDOW_DAYS = 3;
const TRANSFER_WINDOW_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Textual evidence that a row is money movement rather than external activity.
 * Amount-coincidence alone is weak (a paycheck and a rent payment of equal
 * magnitude within the window would otherwise silently vanish from both income
 * and spending), so a transfer pair must also carry wording like this on at
 * least one side.
 */
const TRANSFER_EVIDENCE =
  /transfer|xfer|payment|pymt|autopay|zelle|venmo|cash ?app|withdraw|deposit|move to|move from/i;

function daysApart(a: Transaction, b: Transaction): number {
  return Math.abs(a.transactionDate.getTime() - b.transactionDate.getTime()) / MS_PER_DAY;
}

/**
 * Detection is SYSTEM-actor and must obey the transition table: a row may be
 * (re)labelled `candidate` only when it is already in that state or the state
 * machine allows SYSTEM to move it there. This protects user resolutions
 * (USER_CONFIRMED, EXCLUDED, …) and forbids cross-candidate relabelling such as
 * TRANSFER_CANDIDATE → DUPLICATE_CANDIDATE.
 */
function mayFlag(t: Transaction, candidate: TransactionState): boolean {
  // A linked pending→posted replacement is a legitimate settlement, not a duplicate.
  if (t.replacementTransactionId != null) return false;
  return t.state === candidate || canTransition(t.state, candidate, "SYSTEM");
}

function hasTransferEvidence(t: Transaction): boolean {
  const text = `${t.merchantNormalized ?? ""} ${t.merchantRaw ?? ""} ${t.descriptionRaw ?? ""}`;
  return TRANSFER_EVIDENCE.test(text);
}

/**
 * Flag rows that look like the same charge seen twice: same account, same signed
 * amount, same normalized merchant, within DUPLICATE_WINDOW_DAYS. Each such group
 * shares a deterministic `duplicateGroupId` and its members become
 * DUPLICATE_CANDIDATE.
 */
export function detectDuplicates(transactions: Transaction[]): Transaction[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    // Prefer the normalized merchant; fall back to the raw merchant so detection
    // works on freshly-ingested rows before classification runs.
    const merchant = t.merchantNormalized ?? t.merchantRaw;
    if (!mayFlag(t, "DUPLICATE_CANDIDATE") || merchant == null) continue;
    const key = `${t.accountId}|${t.amountCents}|${merchant}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }

  const flagged = new Map<string, string>(); // txn id → duplicateGroupId
  for (const [key, members] of groups) {
    for (const cluster of clusterByWindow(members, DUPLICATE_WINDOW_DAYS)) {
      if (cluster.length < 2) continue;
      // Anchor the id to the cluster's earliest date so it is deterministic and
      // independent of input order.
      const anchor = cluster[0]!.transactionDate.toISOString().slice(0, 10);
      const groupId = `dup_${stableKey(`${key}|${anchor}`)}`;
      for (const m of cluster) flagged.set(m.id, groupId);
    }
  }

  return transactions.map((t) => {
    const groupId = flagged.get(t.id);
    if (!groupId) return t;
    return { ...t, duplicateGroupId: groupId, state: "DUPLICATE_CANDIDATE" };
  });
}

/**
 * Split same-key rows into date-ordered chains where each member is within
 * `windowDays` of the previous one. Sorting first makes the result independent
 * of input order (the previous implementation anchored the window to whichever
 * member happened to arrive first, flagging all-or-nothing).
 */
function clusterByWindow(members: Transaction[], windowDays: number): Transaction[][] {
  const sorted = [...members].sort((a, b) => {
    const byDate = a.transactionDate.getTime() - b.transactionDate.getTime();
    if (byDate !== 0) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const clusters: Transaction[][] = [];
  let current: Transaction[] = [];
  for (const t of sorted) {
    const previous = current[current.length - 1];
    if (previous && daysApart(previous, t) <= windowDays) current.push(t);
    else {
      if (current.length > 0) clusters.push(current);
      current = [t];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Flag equal-magnitude, opposite-sign rows on DIFFERENT accounts within
 * TRANSFER_WINDOW_DAYS as a money movement between the household's own accounts
 * (covers account-to-account transfers and credit-card payments). Matched pairs
 * share a deterministic `transferGroupId` and become TRANSFER_CANDIDATE.
 */
export function detectTransfers(transactions: Transaction[]): Transaction[] {
  const flaggable = transactions.filter((t) => mayFlag(t, "TRANSFER_CANDIDATE"));
  const outflows = flaggable.filter((t) => t.amountCents < 0);
  const inflows = flaggable.filter((t) => t.amountCents > 0);
  const used = new Set<string>();
  const pairing = new Map<string, string>(); // txn id → transferGroupId

  for (const out of outflows) {
    // Deterministic match: first eligible inflow by id order. At least one side
    // of the pair must carry transfer wording — amount coincidence alone is not
    // enough evidence to silently drop money from income and spending.
    const match = [...inflows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .find(
        (inn) =>
          !used.has(inn.id) &&
          inn.accountId !== out.accountId &&
          inn.amountCents === -out.amountCents &&
          daysApart(out, inn) <= TRANSFER_WINDOW_DAYS &&
          (hasTransferEvidence(out) || hasTransferEvidence(inn)),
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

/** Run both detectors (duplicates first, then transfers) over the ledger. */
export function detectAll(transactions: Transaction[]): Transaction[] {
  return detectTransfers(detectDuplicates(transactions));
}

/** Collapse a grouping key into a filesystem/id-safe deterministic token. */
function stableKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}
