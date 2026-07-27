/**
 * Financial data provider abstraction.
 *
 * All upstream providers (mock, CSV, Plaid, MX, ...) are accessed through the
 * `FinancialDataProvider` interface and return normalized DTOs so the canonical
 * ledger never stores provider-specific field names as primary domain concepts.
 *
 * MONEY SIGN CONVENTION for DTO amounts (`amountCents`, balance fields):
 *   negative = outflow / spend, positive = inflow.
 * Provider access tokens returned by exchangePublicToken are opaque secrets and
 * must never be exposed to client code.
 */

import type { AccountType, ProviderType } from "@/lib/domain/types";
import type { Cents } from "@/lib/utils/money";

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

export type ProviderErrorCode =
  | "account_disconnected"
  | "user_action_required"
  | "rate_limit"
  | "institution_outage"
  | "pending_missing"
  | "transaction_removed"
  | "duplicate_transaction"
  | "webhook_replay"
  | "cursor_reset"
  | "token_invalid"
  | "consent_expired"
  | "account_closed";

export interface ProviderErrorDto {
  code: ProviderErrorCode;
  message: string;
  /** Whether the same call can be retried later without user intervention. */
  retryable: boolean;
  /** True when the user must re-authenticate / re-consent to proceed. */
  requiresUserAction: boolean;
}

// ---------------------------------------------------------------------------
// Normalized DTOs
// ---------------------------------------------------------------------------

export interface ProviderConnectionDto {
  providerConnectionId: string;
  provider: ProviderType;
  providerInstitutionId?: string;
  institutionName?: string;
  status: "ACTIVE" | "STALE" | "RECONNECT_REQUIRED" | "DISCONNECTED" | "ERROR";
  cursor?: string;
  lastSuccessfulSyncAt?: Date;
}

export interface ProviderAccountDto {
  providerAccountId: string;
  displayName: string;
  officialName?: string;
  mask?: string;
  type: AccountType;
  subtype?: string;
  currencyCode: string;
}

export interface ProviderTransactionDto {
  providerTransactionId: string;
  providerAccountId: string;
  /** Provider id of the pending txn this posting replaces, when applicable. */
  providerPendingTransactionId?: string;
  transactionDate: Date;
  authorizedDate?: Date;
  postedAt?: Date;
  /** Signed amount in cents: negative = outflow/spend, positive = inflow. */
  amountCents: Cents;
  currencyCode: string;
  merchantName?: string;
  description?: string;
  isPending: boolean;
  /** Set when the provider reports this transaction was removed/reversed. */
  isRemoved?: boolean;
}

export interface ProviderBalanceDto {
  providerAccountId: string;
  currentCents: Cents;
  availableCents?: Cents;
  currencyCode: string;
  capturedAt: Date;
}

export interface ProviderWebhookEventDto {
  provider: ProviderType;
  eventType: string;
  providerConnectionId?: string;
  providerEventId?: string;
  /** Idempotency key used to detect webhook replays. */
  idempotencyKey?: string;
  receivedAt: Date;
}

// ---------------------------------------------------------------------------
// Method input / result types
// ---------------------------------------------------------------------------

export interface CreateLinkTokenInput {
  householdId: string;
  userId: string;
  /** Optional connection to re-authenticate (reconnect flow). */
  providerConnectionId?: string;
}

export interface LinkTokenResult {
  linkToken: string;
  expiresAt: Date;
}

export interface ExchangeTokenInput {
  householdId: string;
  publicToken: string;
}

export interface ConnectionCredentials {
  providerConnectionId: string;
  /** Opaque provider access token — secret, never sent to client code. */
  accessToken: string;
  itemId?: string;
}

export interface SyncTransactionsInput {
  providerConnectionId: string;
  accessToken: string;
  /** Cursor from the previous sync; omit for an initial full sync. */
  cursor?: string;
}

export interface TransactionSyncResult {
  added: ProviderTransactionDto[];
  modified: ProviderTransactionDto[];
  removed: string[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface BalanceInput {
  providerConnectionId: string;
  accessToken: string;
  providerAccountIds?: string[];
}

export interface BalanceResult {
  balances: ProviderBalanceDto[];
}

export interface DisconnectInput {
  providerConnectionId: string;
  accessToken: string;
}

export interface DisconnectResult {
  providerConnectionId: string;
  disconnectedAt: Date;
}

export interface RefreshConnectionInput {
  providerConnectionId: string;
  accessToken: string;
}

export interface RefreshConnectionResult {
  connection: ProviderConnectionDto;
  accounts: ProviderAccountDto[];
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface FinancialDataProvider {
  createLinkToken(input: CreateLinkTokenInput): Promise<LinkTokenResult>;
  exchangePublicToken(input: ExchangeTokenInput): Promise<ConnectionCredentials>;
  syncTransactions(input: SyncTransactionsInput): Promise<TransactionSyncResult>;
  getBalances(input: BalanceInput): Promise<BalanceResult>;
  disconnect(input: DisconnectInput): Promise<DisconnectResult>;
  refreshConnection(input: RefreshConnectionInput): Promise<RefreshConnectionResult>;
}
