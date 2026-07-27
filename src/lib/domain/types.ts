/**
 * Cadence — canonical domain types.
 *
 * These interfaces model the read-only weekly household finance briefing.
 * They mirror `prisma/schema.prisma` but express money as integer cents
 * (see `Cents`) rather than Decimal, and dates as JS `Date` objects.
 *
 * MONEY SIGN CONVENTION (applies to every `*Cents` field on financial
 * activity such as Transaction.amountCents and ForecastLineItem.amountCents):
 *   negative = outflow / spend (money leaving the household)
 *   positive = inflow (money arriving, e.g. paycheck, refund, reimbursement)
 * Balances (lastBalanceCents, startingBalanceCents, ...) are absolute account
 * positions and are not governed by the inflow/outflow sign rule.
 */

import type { Cents } from "@/lib/utils/money";

// ---------------------------------------------------------------------------
// String-union enums (kept in sync with prisma/schema.prisma enums)
// ---------------------------------------------------------------------------

export type HouseholdRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | "SUPPORT_READONLY";

export type ProviderType =
  | "MOCK"
  | "CSV"
  | "PLAID"
  | "MX"
  | "FINICITY"
  | "TELLER"
  | "YODLEE"
  | "TRUELAYER";

export type ConnectionStatus =
  | "ACTIVE"
  | "STALE"
  | "RECONNECT_REQUIRED"
  | "DISCONNECTED"
  | "ERROR"
  | "DELETED";

export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT_CARD"
  | "LOAN"
  | "MORTGAGE"
  | "INVESTMENT"
  | "CASH"
  | "OTHER";

export type TransactionState =
  | "PENDING"
  | "POSTED"
  | "REMOVED"
  | "NEEDS_REVIEW"
  | "AUTO_CLASSIFIED"
  | "USER_CONFIRMED"
  | "EXCLUDED"
  | "TRANSFER_CANDIDATE"
  | "TRANSFER_CONFIRMED"
  | "DUPLICATE_CANDIDATE"
  | "DUPLICATE_CONFIRMED";

export type RuleStatus = "SUGGESTED" | "ACTIVE" | "PAUSED" | "REJECTED" | "ARCHIVED";

export type RecurringType = "BILL" | "SUBSCRIPTION" | "PAYCHECK" | "TRANSFER" | "OTHER";

export type RecurringFrequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "ANNUAL"
  | "IRREGULAR";

export type MoneyStatus = "SAFE" | "WATCH" | "ACTION_NEEDED" | "DATA_STALE";

export type AiPolicyStatus = "NOT_APPLICABLE" | "PASSED" | "BLOCKED" | "NEEDS_REVIEW";

// ---------------------------------------------------------------------------
// Tenancy & identity
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Household {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HouseholdMember {
  id: string;
  householdId: string;
  userId: string;
  role: HouseholdRole;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Provider connections & accounts
// ---------------------------------------------------------------------------

/**
 * A connection to an upstream data provider. Provider access tokens/secrets
 * are intentionally NOT part of the domain model — they never leave the
 * provider/persistence boundary and must not reach client code.
 */
export interface ProviderConnection {
  id: string;
  householdId: string;
  provider: ProviderType;
  providerInstitutionId?: string;
  institutionName?: string;
  status: ConnectionStatus;
  itemId?: string;
  cursor?: string;
  lastSuccessfulSyncAt?: Date;
  lastAttemptedSyncAt?: Date;
  lastErrorCode?: string;
  lastErrorCategory?: string;
  disconnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinancialAccount {
  id: string;
  householdId: string;
  connectionId?: string;
  providerAccountId?: string;
  displayName: string;
  officialName?: string;
  mask?: string;
  type: AccountType;
  subtype?: string;
  currencyCode: string;
  /** Latest known current balance in cents. */
  lastBalanceCents?: Cents;
  /** Latest known available balance in cents. */
  lastBalanceAvailableCents?: Cents;
  lastBalanceAt?: Date;
  includeInForecast: boolean;
  includeInNetWorth?: boolean;
  isDisconnected: boolean;
  lastSuccessfulSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Canonical ledger
// ---------------------------------------------------------------------------

export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  providerTransactionId?: string;
  /** When a PENDING txn is replaced by its POSTED counterpart, this points to the replacement. */
  replacementTransactionId?: string;
  duplicateGroupId?: string;
  transferGroupId?: string;
  transactionDate: Date;
  postedAt?: Date;
  removedAt?: Date;
  /** Signed amount in cents: negative = outflow/spend, positive = inflow. */
  amountCents: Cents;
  currencyCode: string;
  merchantRaw?: string;
  merchantNormalized?: string;
  descriptionRaw?: string;
  categoryId?: string;
  state: TransactionState;
  isPending: boolean;
  isExcludedFromSpending: boolean;
  isForecastRelevant: boolean;
  confidenceScore: number;
  reviewReason?: string;
  tagIds: string[];
}

export interface Category {
  id: string;
  householdId: string;
  name: string;
  parentId?: string;
}

export interface Tag {
  id: string;
  householdId: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Rules engine
// ---------------------------------------------------------------------------

export interface RuleCondition {
  merchantContains?: string;
  amountEqualsCents?: Cents;
  accountId?: string;
  transactionType?: string;
  descriptionContains?: string;
}

export interface RuleAction {
  setCategoryId?: string;
  addTagId?: string;
  setExcluded?: boolean;
  setTransfer?: boolean;
  setRecurringBill?: boolean;
  requireReview?: boolean;
}

export interface Rule {
  id: string;
  householdId: string;
  name: string;
  status: RuleStatus;
  conditions: RuleCondition[];
  actions: RuleAction;
  confidenceScore: number;
  createdByUserId?: string;
}

export interface RuleApplication {
  id: string;
  ruleId: string;
  transactionId: string;
  appliedAt: Date;
  undoneAt?: Date;
}

// ---------------------------------------------------------------------------
// Recurring obligations
// ---------------------------------------------------------------------------

export interface RecurringObligation {
  id: string;
  householdId: string;
  type: RecurringType;
  name: string;
  merchantNormalized?: string;
  categoryId?: string;
  /** Expected signed amount in cents: negative = bill/outflow, positive = paycheck/inflow. */
  amountCents?: Cents;
  frequency: RecurringFrequency;
  nextExpectedDate?: Date;
  confidenceScore: number;
  isConfirmed: boolean;
  isActive: boolean;
  includeInForecast: boolean;
  accountId?: string;
}

// ---------------------------------------------------------------------------
// Cash-flow forecast
// ---------------------------------------------------------------------------

export type ForecastLineItemSource =
  | "PAYCHECK"
  | "RECURRING_BILL"
  | "SUBSCRIPTION"
  | "PENDING_TRANSACTION"
  | "MANUAL"
  | "CREDIT_CARD_PAYMENT";

export interface ForecastLineItem {
  date: Date;
  label: string;
  /** Signed amount in cents: negative = outflow, positive = inflow. */
  amountCents: Cents;
  source: ForecastLineItemSource;
  confidenceScore: number;
  evidenceId?: string;
}

export interface ForecastRun {
  id: string;
  householdId: string;
  periodStart: Date;
  periodEnd: Date;
  startingBalanceCents: Cents;
  balanceCoverage?: {
    recordedCount: number;
    totalCount: number;
    missingCount: number;
    isComplete: boolean;
  };
  projectedLowBalanceCents?: Cents;
  projectedLowDate?: Date;
  cushionCents?: Cents;
  lineItems: ForecastLineItem[];
  warnings: string[];
  confidenceScore: number;
}

// ---------------------------------------------------------------------------
// Evidence, facts, briefing & AI
// ---------------------------------------------------------------------------

export type EvidenceType =
  | "TRANSACTION"
  | "ACCOUNT"
  | "RECURRING_OBLIGATION"
  | "FORECAST_LINE_ITEM"
  | "COMPARISON_WINDOW"
  | "DATA_HEALTH_WARNING";

export interface Evidence {
  id: string;
  type: EvidenceType;
  refId?: string;
  label: string;
  value?: string;
}

export interface InsightFact {
  id: string;
  factType: string;
  title: string;
  value: unknown;
  evidenceIds: string[];
  confidence: number;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface FactPacket {
  period: { start: Date; end: Date };
  accountCoverage: string;
  staleDataStatus: string;
  metrics: Record<string, unknown>;
  comparisonWindows: Record<string, unknown>;
  forecastAssumptions: string[];
  confidenceLevels: Record<string, number>;
  evidence: Evidence[];
  prohibitedTopicsFlag: boolean;
}

export interface Briefing {
  id: string;
  householdId: string;
  periodStart: Date;
  periodEnd: Date;
  moneyStatus: MoneyStatus;
  facts: InsightFact[];
  aiSummary?: string;
  aiPolicyStatus: AiPolicyStatus;
  dataWarnings: string[];
}

export interface AiGeneration {
  id: string;
  provider: string;
  model: string;
  factPacketHash: string;
  outputText?: string;
  policyStatus: AiPolicyStatus;
  blockedReasons?: string[];
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Audit, sync & data-health
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: string;
  eventType: string;
  severity: string;
  householdId?: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface SyncRun {
  id: string;
  connectionId: string;
  status: string;
  startedAt?: Date;
  completedAt?: Date;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

export type DataHealthWarningKind =
  | "STALE"
  | "DISCONNECTED"
  | "RECONNECT_REQUIRED"
  | "MISSING_DATA"
  | "PARTIAL_SYNC";

export interface DataHealthWarning {
  accountId: string;
  kind: DataHealthWarningKind;
  message: string;
  lastSyncedAt?: Date;
  ageHours?: number;
}

// ---------------------------------------------------------------------------
// Aggregate seed/dataset shape
// ---------------------------------------------------------------------------

export interface HouseholdDataset {
  household: Household;
  members: HouseholdMember[];
  users: User[];
  connections: ProviderConnection[];
  accounts: FinancialAccount[];
  transactions: Transaction[];
  categories: Category[];
  tags: Tag[];
  rules: Rule[];
  recurringObligations: RecurringObligation[];
}
