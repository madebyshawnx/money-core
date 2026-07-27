/**
 * Transaction normalization — provider DTO → canonical ledger row.
 *
 * "The canonical ledger should not store Plaid-only field names as primary
 * domain concepts" (docs/31). This module is the single translation boundary:
 * it maps a normalized `ProviderTransactionDto` onto a `Transaction`, derives the
 * initial settlement state, and leaves classification (category, confidence,
 * tags) and detection (duplicate/transfer groups) to later stages.
 *
 * Pure and deterministic: the canonical id is derived from the provider id, so
 * re-normalizing the same DTO always yields the same id (the basis for
 * idempotent re-ingest — see reconcile.ts).
 */

import type { Transaction } from "@/lib/domain/types";
import type { ProviderTransactionDto } from "@/lib/providers/financial-data/types";

/** Confidence assigned to a freshly-ingested, not-yet-classified record. */
const DEFAULT_CONFIDENCE = 100;

export interface NormalizationContext {
  householdId: string;
  /** Resolve a provider account id to the canonical FinancialAccount id, or undefined if unknown. */
  resolveAccountId: (providerAccountId: string) => string | undefined;
}

export class UnknownAccountError extends Error {
  constructor(readonly providerAccountId: string) {
    super(`No canonical account for provider account "${providerAccountId}"`);
    this.name = "UnknownAccountError";
  }
}

export class InvalidAmountError extends Error {
  constructor(
    readonly providerTransactionId: string,
    readonly amountCents: number,
  ) {
    super(
      `Provider transaction "${providerTransactionId}" has non-integer amountCents ` +
        `${amountCents} — money must arrive as integer cents`,
    );
    this.name = "InvalidAmountError";
  }
}

/** Deterministic canonical id for a provider transaction id. */
export function makeTransactionId(providerTransactionId: string): string {
  return `txn_${providerTransactionId}`;
}

export function normalizeTransaction(
  dto: ProviderTransactionDto,
  ctx: NormalizationContext,
): Transaction {
  const accountId = ctx.resolveAccountId(dto.providerAccountId);
  if (accountId === undefined) {
    throw new UnknownAccountError(dto.providerAccountId);
  }
  // Provider data is raw input, not truth — fail fast on amounts that are not
  // integer cents rather than letting float math corrupt every metric downstream.
  if (!Number.isInteger(dto.amountCents)) {
    throw new InvalidAmountError(dto.providerTransactionId, dto.amountCents);
  }

  const isRemoved = dto.isRemoved === true;
  const isPending = !isRemoved && dto.isPending;

  return {
    id: makeTransactionId(dto.providerTransactionId),
    householdId: ctx.householdId,
    accountId,
    providerTransactionId: dto.providerTransactionId,
    transactionDate: dto.transactionDate,
    postedAt: dto.postedAt,
    amountCents: dto.amountCents,
    currencyCode: dto.currencyCode,
    merchantRaw: dto.merchantName,
    descriptionRaw: dto.description,
    categoryId: undefined,
    state: isRemoved ? "REMOVED" : isPending ? "PENDING" : "POSTED",
    isPending,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: DEFAULT_CONFIDENCE,
    tagIds: [],
  };
}

export function normalizeTransactions(
  dtos: ProviderTransactionDto[],
  ctx: NormalizationContext,
): Transaction[] {
  return dtos.map((dto) => normalizeTransaction(dto, ctx));
}
