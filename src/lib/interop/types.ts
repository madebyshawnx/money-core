/**
 * The Money Manager → Cadence interop bundle — the CONTRACT's one definition.
 *
 * These types existed as hand-maintained mirrors in the two apps
 * (`money-manager/lib/interop/export.ts` producing, Cadence's
 * `lib/providers/money-manager/ingest.ts` consuming) and drifted twice before
 * anything noticed: the consumer's copy never declared
 * `recurringObligations[].categoryId`, so a field the producer deliberately
 * exported ("Manager-confirmed metadata Cadence cannot infer") crossed the
 * wire and was dropped; and the two sides disagreed about `amountCents`
 * optionality. R2-15 moves the definition here, where the provider DTOs it
 * extends already live, so there is exactly one answer to "what is in a
 * bundle".
 *
 * TWO SHAPES, EXPLICITLY. The contract exists on disk as JSON — dates are ISO
 * strings there — while application code needs runtime `Date`s. Pretending one
 * interface describes both is the root of unsafe assertions like
 * `JSON.parse(text) as Bundle`. `InteropBundleWire` is the protocol as
 * serialized; `InteropBundle` is the revived runtime shape. The wire types are
 * spelled out rather than derived with a mapped type on purpose: the
 * required/null/optional distinctions are exactly where the mirror copies
 * drifted, and they must be reviewable at a glance.
 */

import type { AccountType, ConnectionStatus, RecurringFrequency, RecurringType } from "@/lib/domain/types";
import type {
  ProviderAccountDto,
  ProviderBalanceDto,
  ProviderTransactionDto,
} from "@/lib/providers/financial-data/types";
import type { Cents } from "@/lib/utils/money";

export const INTEROP_VERSION = 3;

/** Connection status as exported — `DELETED` is mapped away by the producer. */
export type InteropAccountStatus = Exclude<ConnectionStatus, "DELETED">;

export type InteropOpportunityEffort = "LOW" | "MEDIUM" | "HIGH";

// ---------------------------------------------------------------------------
// Runtime shape — dates are Date instances
//
// The runtime DTOs EXTEND the package's own provider DTOs rather than
// restating their fields — restating them would rebuild, inside one package,
// the exact mirror-type drift R2-15 exists to remove. Only the wire DTOs
// below are spelled out field-by-field, because required/null/optional at
// the serialization boundary is precisely where the historical drift lived
// and must stay reviewable at a glance.
// ---------------------------------------------------------------------------

export interface InteropAccountDto extends ProviderAccountDto {
  status: InteropAccountStatus;
  lastSuccessfulSyncAt?: Date;
  includeInNetWorth?: boolean;
}

export type InteropBalanceDto = ProviderBalanceDto;

export interface InteropTransactionDto extends ProviderTransactionDto {
  /** Manager-confirmed category for the transaction. */
  categoryId?: string;
}

export interface InteropCategoryDto {
  id: string;
  name: string;
  parentId?: string;
}

export interface InteropRecurringObligationDto {
  id: string;
  name: string;
  merchantNormalized?: string;
  /** Manager-confirmed category — the field the consumer's mirror dropped (AUD-3 F1). */
  categoryId?: string;
  /**
   * REQUIRED, `null` for a confirmed obligation with no learned amount. The v3
   * producer always emits it; an optional marker here would describe a
   * producer shape that cannot occur — the other half of the historical drift.
   */
  amountCents: Cents | null;
  frequency: RecurringFrequency;
  type: RecurringType;
  isActive: boolean;
  isConfirmed: boolean;
  includeInForecast: boolean;
  nextExpectedDate?: Date;
  accountId?: string;
}

export interface InteropOptimizerOpportunityDto {
  id: string;
  type: string;
  title: string;
  statement: string;
  estMonthlySavingsCents: Cents;
  confidence: number;
  effort: InteropOpportunityEffort;
  evidenceIds: string[];
  assumptions: string[];
}

export interface InteropBundle {
  interopVersion: typeof INTEROP_VERSION;
  provider: "MONEY_MANAGER";
  householdId: string;
  exportedAt: Date;
  accounts: InteropAccountDto[];
  balances: InteropBalanceDto[];
  transactions: InteropTransactionDto[];
  categories: InteropCategoryDto[];
  recurringObligations: InteropRecurringObligationDto[];
  optimizerOpportunities: InteropOptimizerOpportunityDto[];
}

// ---------------------------------------------------------------------------
// Wire shape — dates are ISO-8601 strings, exactly as JSON carries them
// ---------------------------------------------------------------------------

export interface InteropAccountWire {
  providerAccountId: string;
  displayName: string;
  officialName?: string;
  mask?: string;
  type: AccountType;
  subtype?: string;
  currencyCode: string;
  status: InteropAccountStatus;
  lastSuccessfulSyncAt?: string;
  includeInNetWorth?: boolean;
}

export interface InteropBalanceWire {
  providerAccountId: string;
  currentCents: number;
  availableCents?: number;
  currencyCode: string;
  capturedAt: string;
}

export interface InteropTransactionWire {
  providerTransactionId: string;
  providerAccountId: string;
  providerPendingTransactionId?: string;
  transactionDate: string;
  authorizedDate?: string;
  postedAt?: string;
  amountCents: number;
  currencyCode: string;
  merchantName?: string;
  description?: string;
  isPending: boolean;
  isRemoved?: boolean;
  categoryId?: string;
}

export interface InteropRecurringObligationWire {
  id: string;
  name: string;
  merchantNormalized?: string;
  categoryId?: string;
  amountCents: number | null;
  frequency: RecurringFrequency;
  type: RecurringType;
  isActive: boolean;
  isConfirmed: boolean;
  includeInForecast: boolean;
  nextExpectedDate?: string;
  accountId?: string;
}

export interface InteropBundleWire {
  interopVersion: typeof INTEROP_VERSION;
  provider: "MONEY_MANAGER";
  householdId: string;
  exportedAt: string;
  accounts: InteropAccountWire[];
  balances: InteropBalanceWire[];
  transactions: InteropTransactionWire[];
  categories: InteropCategoryDto[];
  recurringObligations: InteropRecurringObligationWire[];
  optimizerOpportunities: InteropOptimizerOpportunityDto[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** One machine-readable finding. `path` is stable, e.g. `transactions[3].amountCents`. */
export interface InteropIssue {
  code: string;
  path: string;
  message: string;
  actual?: unknown;
}

export type InteropFailureCode = "invalid_json" | "unsupported_version" | "invalid_bundle";

export type InteropParseResult =
  | { ok: true; bundle: InteropBundle; warnings: InteropIssue[] }
  | { ok: false; code: "invalid_json"; issues: InteropIssue[] }
  | {
      ok: false;
      code: "unsupported_version";
      actualVersion: number;
      supportedVersion: typeof INTEROP_VERSION;
      issues: InteropIssue[];
    }
  | { ok: false; code: "invalid_bundle"; issues: InteropIssue[] };

export type InteropValidationResult =
  | { ok: true }
  | { ok: false; code: "invalid_bundle"; issues: InteropIssue[] };

export type InteropSerializationResult =
  | { ok: true; text: string }
  | { ok: false; code: "invalid_bundle"; issues: InteropIssue[] };
