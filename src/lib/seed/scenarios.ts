/**
 * Deterministic seed datasets for Cadence.
 *
 * Every date is derived from `SEED_NOW` — never from `Date.now()` — so seed
 * output is byte-stable across runs and test snapshots.
 *
 * MONEY SIGN CONVENTION for `*Cents` activity amounts:
 *   negative = outflow / spend, positive = inflow (paycheck, refund, reimbursement).
 * Balance fields (lastBalanceCents) are absolute account positions; a negative
 * credit-card balance means an amount owed.
 *
 * The PRIMARY dataset (The Rivera Household) intentionally embodies the doc-34
 * scenarios: healthy baseline, a stale credit card, a pending→posted restaurant
 * replacement with tip, a duplicate hotel authorization hold, a Venmo
 * reimbursement candidate, Target/Amazon review items, a newly-detected
 * subscription, recurring bills + upcoming paycheck + a thin pre-payday cushion,
 * a suggested Trader Joe's rule, and a disconnected account excluded from the
 * forecast. The Chen Household is a clean, clearly-SAFE month.
 */

import type {
  Category,
  FinancialAccount,
  Household,
  HouseholdDataset,
  HouseholdMember,
  ProviderConnection,
  RecurringObligation,
  Rule,
  Tag,
  Transaction,
  User,
} from "@/lib/domain/types";

/** Anchor instant for all seed dates. */
export const SEED_NOW = new Date("2026-07-11T12:00:00.000Z");

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Date offset by whole days from SEED_NOW (negative = past, positive = future). */
function daysFromNow(days: number): Date {
  return new Date(SEED_NOW.getTime() + days * MS_PER_DAY);
}

/** Date offset by whole hours from SEED_NOW (negative = past, positive = future). */
function hoursFromNow(hours: number): Date {
  return new Date(SEED_NOW.getTime() + hours * MS_PER_HOUR);
}

/** Stand-in "record created" instant for long-lived rows (accounts, users). */
const LONG_AGO = daysFromNow(-180);

// ===========================================================================
// PRIMARY — The Rivera Household
// ===========================================================================

const riveraUsers: User[] = [
  {
    id: "usr_rivera_maria",
    email: "maria.rivera@example.com",
    name: "Maria Rivera",
    createdAt: LONG_AGO,
    updatedAt: daysFromNow(-2),
  },
  {
    id: "usr_rivera_diego",
    email: "diego.rivera@example.com",
    name: "Diego Rivera",
    createdAt: LONG_AGO,
    updatedAt: daysFromNow(-2),
  },
];

const riveraHousehold: Household = {
  id: "hh_rivera",
  name: "The Rivera Household",
  createdAt: LONG_AGO,
  updatedAt: daysFromNow(-1),
};

const riveraMembers: HouseholdMember[] = [
  {
    id: "mem_rivera_maria",
    householdId: "hh_rivera",
    userId: "usr_rivera_maria",
    role: "OWNER",
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  },
  {
    id: "mem_rivera_diego",
    householdId: "hh_rivera",
    userId: "usr_rivera_diego",
    role: "MEMBER",
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  },
];

const riveraConnections: ProviderConnection[] = [
  // Healthy checking/savings connection.
  {
    id: "conn_rivera_bank",
    householdId: "hh_rivera",
    provider: "MOCK",
    providerInstitutionId: "ins_evergreen",
    institutionName: "Evergreen Bank",
    status: "ACTIVE",
    itemId: "mock-item-evergreen",
    cursor: "mock-cursor-evergreen-42",
    lastSuccessfulSyncAt: hoursFromNow(-2),
    lastAttemptedSyncAt: hoursFromNow(-2),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-2),
  },
  // STALE credit-card connection: last successful sync ~22h before SEED_NOW.
  {
    id: "conn_rivera_card",
    householdId: "hh_rivera",
    provider: "MOCK",
    providerInstitutionId: "ins_summit",
    institutionName: "Summit Card",
    status: "STALE",
    itemId: "mock-item-summit",
    cursor: "mock-cursor-summit-18",
    lastSuccessfulSyncAt: hoursFromNow(-22),
    lastAttemptedSyncAt: hoursFromNow(-1),
    lastErrorCode: "institution_outage",
    lastErrorCategory: "TEMPORARY",
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-1),
  },
  // DISCONNECTED legacy connection (account excluded from forecast).
  {
    id: "conn_rivera_legacy",
    householdId: "hh_rivera",
    provider: "MOCK",
    providerInstitutionId: "ins_old_union",
    institutionName: "Old Union CU",
    status: "DISCONNECTED",
    lastSuccessfulSyncAt: daysFromNow(-30),
    lastAttemptedSyncAt: daysFromNow(-14),
    disconnectedAt: daysFromNow(-14),
    createdAt: LONG_AGO,
    updatedAt: daysFromNow(-14),
  },
];

const riveraAccounts: FinancialAccount[] = [
  {
    id: "acct_rivera_checking",
    householdId: "hh_rivera",
    connectionId: "conn_rivera_bank",
    providerAccountId: "mock-acct-checking",
    displayName: "Everyday Checking",
    officialName: "Evergreen Everyday Checking",
    mask: "4021",
    type: "CHECKING",
    subtype: "checking",
    currencyCode: "USD",
    lastBalanceCents: 245000, // $2,450.00
    lastBalanceAvailableCents: 241000,
    lastBalanceAt: hoursFromNow(-2),
    includeInForecast: true,
    includeInNetWorth: true,
    isDisconnected: false,
    lastSuccessfulSyncAt: hoursFromNow(-2),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-2),
  },
  {
    id: "acct_rivera_savings",
    householdId: "hh_rivera",
    connectionId: "conn_rivera_bank",
    providerAccountId: "mock-acct-savings",
    displayName: "Rainy Day Savings",
    officialName: "Evergreen High-Yield Savings",
    mask: "7788",
    type: "SAVINGS",
    subtype: "savings",
    currencyCode: "USD",
    lastBalanceCents: 830000, // $8,300.00
    lastBalanceAvailableCents: 830000,
    lastBalanceAt: hoursFromNow(-2),
    includeInForecast: true,
    includeInNetWorth: true,
    isDisconnected: false,
    lastSuccessfulSyncAt: hoursFromNow(-2),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-2),
  },
  {
    id: "acct_rivera_credit",
    householdId: "hh_rivera",
    connectionId: "conn_rivera_card",
    providerAccountId: "mock-acct-credit",
    displayName: "Summit Rewards Card",
    officialName: "Summit Rewards Visa",
    mask: "9931",
    type: "CREDIT_CARD",
    subtype: "credit card",
    currencyCode: "USD",
    lastBalanceCents: -142500, // owes $1,425.00
    lastBalanceAvailableCents: 357500,
    lastBalanceAt: hoursFromNow(-22),
    includeInForecast: true,
    includeInNetWorth: true,
    isDisconnected: false,
    lastSuccessfulSyncAt: hoursFromNow(-22), // stale relative to SEED_NOW
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-22),
  },
  // Disconnected legacy account: excluded from forecast.
  {
    id: "acct_rivera_legacy_checking",
    householdId: "hh_rivera",
    connectionId: "conn_rivera_legacy",
    providerAccountId: "mock-acct-legacy",
    displayName: "Old Union Checking",
    mask: "1102",
    type: "CHECKING",
    subtype: "checking",
    currencyCode: "USD",
    lastBalanceCents: 15200,
    lastBalanceAt: daysFromNow(-30),
    includeInForecast: false,
    includeInNetWorth: false,
    isDisconnected: true,
    lastSuccessfulSyncAt: daysFromNow(-30),
    createdAt: LONG_AGO,
    updatedAt: daysFromNow(-14),
  },
];

const riveraCategories: Category[] = [
  { id: "cat_rivera_income", householdId: "hh_rivera", name: "Income" },
  { id: "cat_rivera_groceries", householdId: "hh_rivera", name: "Groceries" },
  { id: "cat_rivera_dining", householdId: "hh_rivera", name: "Dining & Restaurants" },
  { id: "cat_rivera_shopping", householdId: "hh_rivera", name: "Shopping" },
  { id: "cat_rivera_housing", householdId: "hh_rivera", name: "Housing" },
  { id: "cat_rivera_childcare", householdId: "hh_rivera", name: "Childcare" },
  { id: "cat_rivera_utilities", householdId: "hh_rivera", name: "Utilities" },
  { id: "cat_rivera_subscriptions", householdId: "hh_rivera", name: "Subscriptions" },
  { id: "cat_rivera_transfers", householdId: "hh_rivera", name: "Transfers" },
];

const riveraTags: Tag[] = [
  { id: "tag_rivera_reimbursable", householdId: "hh_rivera", name: "reimbursable" },
  { id: "tag_rivera_needs_split", householdId: "hh_rivera", name: "needs-split" },
];

const riveraRules: Rule[] = [
  // SUGGESTED rule awaiting user approval (scenario 9).
  {
    id: "rule_rivera_trader_joes",
    householdId: "hh_rivera",
    name: "Trader Joe's → Groceries",
    status: "SUGGESTED",
    conditions: [{ merchantContains: "Trader Joe's" }],
    actions: { setCategoryId: "cat_rivera_groceries" },
    confidenceScore: 88,
    createdByUserId: undefined,
  },
];

const riveraRecurring: RecurringObligation[] = [
  {
    id: "rec_rivera_paycheck",
    householdId: "hh_rivera",
    type: "PAYCHECK",
    name: "Paycheck — Maria",
    merchantNormalized: "Northwind Payroll",
    amountCents: 412000, // +$4,120.00 inflow
    frequency: "BIWEEKLY",
    nextExpectedDate: daysFromNow(3),
    confidenceScore: 96,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_checking",
  },
  {
    id: "rec_rivera_mortgage",
    householdId: "hh_rivera",
    type: "BILL",
    name: "Mortgage",
    merchantNormalized: "Cascade Mortgage",
    amountCents: -215000, // -$2,150.00
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(20),
    confidenceScore: 98,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_checking",
  },
  {
    id: "rec_rivera_daycare",
    householdId: "hh_rivera",
    type: "BILL",
    name: "Little Sprouts Daycare",
    merchantNormalized: "Little Sprouts Daycare",
    amountCents: -132000, // -$1,320.00
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(2), // hits before payday — drives cushion risk
    confidenceScore: 95,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_checking",
  },
  {
    id: "rec_rivera_utilities",
    householdId: "hh_rivera",
    type: "BILL",
    name: "City Utilities",
    merchantNormalized: "City Utilities",
    amountCents: -18500, // -$185.00
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(1), // hits before payday
    confidenceScore: 90,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_checking",
  },
  {
    id: "rec_rivera_water_unknown",
    householdId: "hh_rivera",
    type: "BILL",
    name: "Water service",
    merchantNormalized: "Water service",
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(9),
    confidenceScore: 76,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_checking",
  },
  {
    id: "rec_rivera_netflix",
    householdId: "hh_rivera",
    type: "SUBSCRIPTION",
    name: "Netflix",
    merchantNormalized: "Netflix",
    amountCents: -1899, // -$18.99
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(6),
    confidenceScore: 93,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_rivera_credit",
  },
  // Newly-detected subscription — not yet confirmed by the household (scenario 7).
  {
    id: "rec_rivera_cloudfit",
    householdId: "hh_rivera",
    type: "SUBSCRIPTION",
    name: "CloudFit+ (newly detected)",
    merchantNormalized: "CloudFit",
    amountCents: -2999, // -$29.99
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(12),
    confidenceScore: 62,
    isConfirmed: false,
    isActive: true,
    includeInForecast: false,
    accountId: "acct_rivera_credit",
  },
];

const riveraTransactions: Transaction[] = [
  // --- Healthy baseline history ---
  {
    id: "txn_rivera_paycheck_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_checking",
    providerTransactionId: "mock-txn-pay-1",
    transactionDate: daysFromNow(-11),
    postedAt: daysFromNow(-11),
    amountCents: 412000,
    currencyCode: "USD",
    merchantRaw: "DIR DEP - NORTHWIND LLC",
    merchantNormalized: "Northwind Payroll",
    descriptionRaw: "ACH CREDIT DIRECT DEPOSIT",
    categoryId: "cat_rivera_income",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: true,
    isForecastRelevant: false,
    confidenceScore: 99,
    tagIds: [],
  },
  {
    id: "txn_rivera_mortgage_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_checking",
    providerTransactionId: "mock-txn-mtg-1",
    transactionDate: daysFromNow(-10),
    postedAt: daysFromNow(-10),
    amountCents: -215000,
    currencyCode: "USD",
    merchantRaw: "CASCADE MTG PYMT",
    merchantNormalized: "Cascade Mortgage",
    descriptionRaw: "WEB PMT CASCADE MORTGAGE",
    categoryId: "cat_rivera_housing",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 98,
    tagIds: [],
  },
  {
    id: "txn_rivera_daycare_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_checking",
    providerTransactionId: "mock-txn-dc-1",
    transactionDate: daysFromNow(-9),
    postedAt: daysFromNow(-9),
    amountCents: -132000,
    currencyCode: "USD",
    merchantRaw: "LITTLE SPROUTS",
    merchantNormalized: "Little Sprouts Daycare",
    categoryId: "cat_rivera_childcare",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 97,
    tagIds: [],
  },
  {
    id: "txn_rivera_utilities_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_checking",
    providerTransactionId: "mock-txn-util-1",
    transactionDate: daysFromNow(-9),
    postedAt: daysFromNow(-9),
    amountCents: -18500,
    currencyCode: "USD",
    merchantRaw: "CITY UTIL WEB PMT",
    merchantNormalized: "City Utilities",
    categoryId: "cat_rivera_utilities",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 96,
    tagIds: [],
  },
  {
    id: "txn_rivera_netflix_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-nflx-1",
    transactionDate: daysFromNow(-8),
    postedAt: daysFromNow(-8),
    amountCents: -1899,
    currencyCode: "USD",
    merchantRaw: "NETFLIX.COM",
    merchantNormalized: "Netflix",
    categoryId: "cat_rivera_subscriptions",
    state: "AUTO_CLASSIFIED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 92,
    tagIds: [],
  },
  {
    id: "txn_rivera_costco_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-costco-1",
    transactionDate: daysFromNow(-7),
    postedAt: daysFromNow(-7),
    amountCents: -18932,
    currencyCode: "USD",
    merchantRaw: "COSTCO WHSE #114",
    merchantNormalized: "Costco",
    categoryId: "cat_rivera_groceries",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
  },
  {
    id: "txn_rivera_apple_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-apple-1",
    transactionDate: daysFromNow(-6),
    postedAt: daysFromNow(-6),
    amountCents: -999,
    currencyCode: "USD",
    merchantRaw: "APPLE.COM/BILL",
    merchantNormalized: "Apple",
    categoryId: "cat_rivera_subscriptions",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
  },
  // Supports newly-detected CloudFit subscription.
  {
    id: "txn_rivera_cloudfit_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-cloudfit-1",
    transactionDate: daysFromNow(-6),
    postedAt: daysFromNow(-6),
    amountCents: -2999,
    currencyCode: "USD",
    merchantRaw: "CLOUDFIT PLUS",
    merchantNormalized: "CloudFit",
    categoryId: "cat_rivera_subscriptions",
    state: "AUTO_CLASSIFIED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 60,
    tagIds: [],
  },
  // --- Target: needs category/split review (scenario 6) ---
  {
    id: "txn_rivera_target_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-target-1",
    transactionDate: daysFromNow(-5),
    postedAt: daysFromNow(-5),
    amountCents: -12450,
    currencyCode: "USD",
    merchantRaw: "TARGET 00023",
    merchantNormalized: "Target",
    categoryId: undefined,
    state: "NEEDS_REVIEW",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 48,
    reviewReason: "Mixed household + grocery order — may need a split.",
    tagIds: ["tag_rivera_needs_split"],
  },
  // --- Trader Joe's: uncategorized; matches the suggested rule (scenario 9) ---
  {
    id: "txn_rivera_trader_joes_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-tj-1",
    transactionDate: daysFromNow(-4),
    postedAt: daysFromNow(-4),
    amountCents: -6721,
    currencyCode: "USD",
    merchantRaw: "TRADER JOE'S #451",
    merchantNormalized: "Trader Joe's",
    categoryId: undefined,
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 70,
    tagIds: [],
  },
  // --- Amazon: needs category review (scenario 6) ---
  {
    id: "txn_rivera_amazon_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-amzn-1",
    transactionDate: daysFromNow(-3),
    postedAt: daysFromNow(-3),
    amountCents: -8734,
    currencyCode: "USD",
    merchantRaw: "AMZN Mktp US*2K4RT9",
    merchantNormalized: "Amazon",
    categoryId: undefined,
    state: "NEEDS_REVIEW",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 45,
    reviewReason: "Multi-item order — confirm category.",
    tagIds: [],
  },
  // --- Duplicate-looking hotel authorization hold (scenario 4) ---
  {
    id: "txn_rivera_hotel_hold",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-hotel-hold",
    transactionDate: daysFromNow(-2),
    amountCents: -28900,
    currencyCode: "USD",
    merchantRaw: "HARBOR GRAND HOLD",
    merchantNormalized: "Harbor Grand Hotel",
    categoryId: undefined,
    duplicateGroupId: "grp_rivera_hotel",
    state: "DUPLICATE_CANDIDATE",
    isPending: true,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 40,
    reviewReason: "Possible duplicate authorization hold at the same hotel.",
    tagIds: [],
  },
  {
    id: "txn_rivera_hotel_charge",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-hotel-charge",
    transactionDate: daysFromNow(-2),
    postedAt: daysFromNow(-2),
    amountCents: -28900,
    currencyCode: "USD",
    merchantRaw: "HARBOR GRAND HOTEL",
    merchantNormalized: "Harbor Grand Hotel",
    categoryId: "cat_rivera_dining",
    duplicateGroupId: "grp_rivera_hotel",
    state: "DUPLICATE_CANDIDATE",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 55,
    reviewReason: "Possible duplicate of the pending authorization hold.",
    tagIds: [],
  },
  // --- Venmo reimbursement candidate (scenario 5) ---
  {
    id: "txn_rivera_venmo_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_checking",
    providerTransactionId: "mock-txn-venmo-1",
    transactionDate: daysFromNow(-2),
    postedAt: daysFromNow(-2),
    amountCents: 2650, // +$26.50 inflow
    currencyCode: "USD",
    merchantRaw: "VENMO CASHOUT",
    merchantNormalized: "Venmo",
    descriptionRaw: "VENMO PAYMENT RECEIVED",
    categoryId: undefined,
    transferGroupId: "grp_rivera_venmo",
    state: "NEEDS_REVIEW",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 50,
    reviewReason: "Incoming Venmo — confirm whether this reimburses a shared expense.",
    tagIds: ["tag_rivera_reimbursable"],
  },
  // --- Restaurant: PENDING that is later replaced by a POSTED charge w/ tip (scenario 3) ---
  {
    id: "txn_rivera_dining_pending",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-dining-pending",
    replacementTransactionId: "txn_rivera_dining_posted",
    transactionDate: daysFromNow(-1),
    amountCents: -4200, // pre-tip authorization
    currencyCode: "USD",
    merchantRaw: "OSTERIA VERDE",
    merchantNormalized: "Osteria Verde",
    categoryId: "cat_rivera_dining",
    state: "PENDING",
    isPending: true,
    isExcludedFromSpending: false,
    isForecastRelevant: true,
    confidenceScore: 80,
    tagIds: [],
  },
  {
    id: "txn_rivera_dining_posted",
    householdId: "hh_rivera",
    accountId: "acct_rivera_credit",
    providerTransactionId: "mock-txn-dining-posted",
    transactionDate: hoursFromNow(-8),
    postedAt: hoursFromNow(-8),
    amountCents: -4956, // posted with tip — larger magnitude than the hold
    currencyCode: "USD",
    merchantRaw: "OSTERIA VERDE",
    merchantNormalized: "Osteria Verde",
    categoryId: "cat_rivera_dining",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 95,
    tagIds: [],
  },
  // --- Activity on the disconnected legacy account (scenario 10) ---
  {
    id: "txn_rivera_legacy_1",
    householdId: "hh_rivera",
    accountId: "acct_rivera_legacy_checking",
    providerTransactionId: "mock-txn-legacy-1",
    transactionDate: daysFromNow(-32),
    postedAt: daysFromNow(-32),
    amountCents: -5000,
    currencyCode: "USD",
    merchantRaw: "OLD UNION POS",
    merchantNormalized: "Corner Market",
    categoryId: "cat_rivera_groceries",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false, // account excluded from forecast
    confidenceScore: 80,
    tagIds: [],
  },
];

const riveraDataset: HouseholdDataset = {
  household: riveraHousehold,
  members: riveraMembers,
  users: riveraUsers,
  connections: riveraConnections,
  accounts: riveraAccounts,
  transactions: riveraTransactions,
  categories: riveraCategories,
  tags: riveraTags,
  rules: riveraRules,
  recurringObligations: riveraRecurring,
};

// ===========================================================================
// SECONDARY — The Chen Household (clean, clearly-SAFE month)
// ===========================================================================

const chenUsers: User[] = [
  {
    id: "usr_chen_grace",
    email: "grace.chen@example.com",
    name: "Grace Chen",
    createdAt: LONG_AGO,
    updatedAt: daysFromNow(-3),
  },
];

const chenHousehold: Household = {
  id: "hh_chen",
  name: "The Chen Household",
  createdAt: LONG_AGO,
  updatedAt: daysFromNow(-3),
};

const chenMembers: HouseholdMember[] = [
  {
    id: "mem_chen_grace",
    householdId: "hh_chen",
    userId: "usr_chen_grace",
    role: "OWNER",
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
  },
];

const chenConnections: ProviderConnection[] = [
  {
    id: "conn_chen_bank",
    householdId: "hh_chen",
    provider: "MOCK",
    providerInstitutionId: "ins_pacific_one",
    institutionName: "Pacific One Bank",
    status: "ACTIVE",
    itemId: "mock-item-pacific",
    cursor: "mock-cursor-pacific-7",
    lastSuccessfulSyncAt: hoursFromNow(-1),
    lastAttemptedSyncAt: hoursFromNow(-1),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-1),
  },
];

const chenAccounts: FinancialAccount[] = [
  {
    id: "acct_chen_checking",
    householdId: "hh_chen",
    connectionId: "conn_chen_bank",
    providerAccountId: "mock-acct-chen-checking",
    displayName: "Everyday Checking",
    officialName: "Pacific One Checking",
    mask: "3310",
    type: "CHECKING",
    subtype: "checking",
    currencyCode: "USD",
    lastBalanceCents: 680000, // $6,800.00
    lastBalanceAvailableCents: 680000,
    lastBalanceAt: hoursFromNow(-1),
    includeInForecast: true,
    includeInNetWorth: true,
    isDisconnected: false,
    lastSuccessfulSyncAt: hoursFromNow(-1),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-1),
  },
  {
    id: "acct_chen_savings",
    householdId: "hh_chen",
    connectionId: "conn_chen_bank",
    providerAccountId: "mock-acct-chen-savings",
    displayName: "Emergency Fund",
    officialName: "Pacific One Savings",
    mask: "9042",
    type: "SAVINGS",
    subtype: "savings",
    currencyCode: "USD",
    lastBalanceCents: 2500000, // $25,000.00
    lastBalanceAvailableCents: 2500000,
    lastBalanceAt: hoursFromNow(-1),
    includeInForecast: true,
    includeInNetWorth: true,
    isDisconnected: false,
    lastSuccessfulSyncAt: hoursFromNow(-1),
    createdAt: LONG_AGO,
    updatedAt: hoursFromNow(-1),
  },
];

const chenCategories: Category[] = [
  { id: "cat_chen_income", householdId: "hh_chen", name: "Income" },
  { id: "cat_chen_groceries", householdId: "hh_chen", name: "Groceries" },
  { id: "cat_chen_housing", householdId: "hh_chen", name: "Housing" },
  { id: "cat_chen_shopping", householdId: "hh_chen", name: "Shopping" },
  { id: "cat_chen_subscriptions", householdId: "hh_chen", name: "Subscriptions" },
];

const chenTags: Tag[] = [];

const chenRules: Rule[] = [];

const chenRecurring: RecurringObligation[] = [
  {
    id: "rec_chen_paycheck",
    householdId: "hh_chen",
    type: "PAYCHECK",
    name: "Paycheck — Grace",
    merchantNormalized: "Meridian Labs Payroll",
    amountCents: 560000, // +$5,600.00
    frequency: "BIWEEKLY",
    nextExpectedDate: daysFromNow(2),
    confidenceScore: 97,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_chen_checking",
  },
  {
    id: "rec_chen_rent",
    householdId: "hh_chen",
    type: "BILL",
    name: "Rent",
    merchantNormalized: "Bayview Apartments",
    amountCents: -180000, // -$1,800.00
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(20),
    confidenceScore: 98,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_chen_checking",
  },
  {
    id: "rec_chen_spotify",
    householdId: "hh_chen",
    type: "SUBSCRIPTION",
    name: "Spotify",
    merchantNormalized: "Spotify",
    amountCents: -1099, // -$10.99
    frequency: "MONTHLY",
    nextExpectedDate: daysFromNow(7),
    confidenceScore: 94,
    isConfirmed: true,
    isActive: true,
    includeInForecast: true,
    accountId: "acct_chen_checking",
  },
];

const chenTransactions: Transaction[] = [
  {
    id: "txn_chen_paycheck_1",
    householdId: "hh_chen",
    accountId: "acct_chen_checking",
    providerTransactionId: "mock-txn-chen-pay-1",
    transactionDate: daysFromNow(-12),
    postedAt: daysFromNow(-12),
    amountCents: 560000,
    currencyCode: "USD",
    merchantRaw: "DIR DEP - MERIDIAN LABS",
    merchantNormalized: "Meridian Labs Payroll",
    categoryId: "cat_chen_income",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: true,
    isForecastRelevant: false,
    confidenceScore: 99,
    tagIds: [],
  },
  {
    id: "txn_chen_rent_1",
    householdId: "hh_chen",
    accountId: "acct_chen_checking",
    providerTransactionId: "mock-txn-chen-rent-1",
    transactionDate: daysFromNow(-10),
    postedAt: daysFromNow(-10),
    amountCents: -180000,
    currencyCode: "USD",
    merchantRaw: "BAYVIEW APTS RENT",
    merchantNormalized: "Bayview Apartments",
    categoryId: "cat_chen_housing",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 98,
    tagIds: [],
  },
  {
    id: "txn_chen_spotify_1",
    householdId: "hh_chen",
    accountId: "acct_chen_checking",
    providerTransactionId: "mock-txn-chen-spotify-1",
    transactionDate: daysFromNow(-8),
    postedAt: daysFromNow(-8),
    amountCents: -1099,
    currencyCode: "USD",
    merchantRaw: "SPOTIFY USA",
    merchantNormalized: "Spotify",
    categoryId: "cat_chen_subscriptions",
    state: "AUTO_CLASSIFIED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 92,
    tagIds: [],
  },
  {
    id: "txn_chen_costco_1",
    householdId: "hh_chen",
    accountId: "acct_chen_checking",
    providerTransactionId: "mock-txn-chen-costco-1",
    transactionDate: daysFromNow(-5),
    postedAt: daysFromNow(-5),
    amountCents: -12000,
    currencyCode: "USD",
    merchantRaw: "COSTCO WHSE #221",
    merchantNormalized: "Costco",
    categoryId: "cat_chen_groceries",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 90,
    tagIds: [],
  },
  {
    id: "txn_chen_amazon_1",
    householdId: "hh_chen",
    accountId: "acct_chen_checking",
    providerTransactionId: "mock-txn-chen-amzn-1",
    transactionDate: daysFromNow(-3),
    postedAt: daysFromNow(-3),
    amountCents: -4500,
    currencyCode: "USD",
    merchantRaw: "AMZN Mktp US*9QP",
    merchantNormalized: "Amazon",
    categoryId: "cat_chen_shopping",
    state: "POSTED",
    isPending: false,
    isExcludedFromSpending: false,
    isForecastRelevant: false,
    confidenceScore: 88,
    tagIds: [],
  },
];

const chenDataset: HouseholdDataset = {
  household: chenHousehold,
  members: chenMembers,
  users: chenUsers,
  connections: chenConnections,
  accounts: chenAccounts,
  transactions: chenTransactions,
  categories: chenCategories,
  tags: chenTags,
  rules: chenRules,
  recurringObligations: chenRecurring,
};

// ===========================================================================
// Public accessors
// ===========================================================================

/** All seed households. Order is stable: [Rivera (primary), Chen]. */
export function getSeedDatasets(): HouseholdDataset[] {
  return [riveraDataset, chenDataset];
}

/** The primary demo household (The Rivera Household). */
export function getPrimaryDataset(): HouseholdDataset {
  return riveraDataset;
}
