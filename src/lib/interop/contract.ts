/**
 * The interop contract's enforcement — parse, validate, serialize.
 *
 * HAND-ROLLED on purpose. This is one versioned, bounded object graph with no
 * compositional schema needs, and the semantics that matter most — the date
 * policy, exact-version handling, canonical serialization — would be custom
 * transforms in any schema library anyway. The cost is hand-maintained checks;
 * they live in ONE file beside the one type definition, which is the point of
 * R2-15. Unknown properties are REJECTED: the contract is version-exact, so a
 * new field is an interop-version decision, never silent drift.
 *
 * THE DATE POLICY (owned here; inherited from the consumer's #34 hardening):
 *   - REQUIRED dates (`exportedAt`, `transactionDate`, `capturedAt`) refuse
 *     the bundle. A bundle that cannot say when it was written, or a
 *     transaction that cannot say when it happened, poisons every downstream
 *     fact — refuse whole rather than compute money over NaN.
 *   - OPTIONAL dates degrade to `undefined` WITH A WARNING. Absence is a state
 *     the products report honestly (UNKNOWN freshness); an Invalid Date is
 *     not. The warning keeps the degradation observable instead of silently
 *     repairing producer corruption.
 *   - Only ISO-ish STRINGS parse on the wire. `new Date(0)`, `new Date(null)`
 *     and `new Date(false)` all coerce to a perfectly valid 1970 epoch, so a
 *     type-corrupted field would otherwise become a fabricated very-stale
 *     timestamp.
 *   - The PRODUCER side is stricter: an invalid optional `Date` REFUSES
 *     serialization. The producer controls its data and must not emit known
 *     corruption for the consumer to degrade.
 */

import type { AccountType, RecurringFrequency, RecurringType, TransactionState } from "@/lib/domain/types";
import {
  INTEROP_VERSION,
  type InteropAccountDto,
  type InteropAccountStatus,
  type InteropBalanceDto,
  type InteropBundle,
  type InteropBundleWire,
  type InteropCategoryDto,
  type InteropIssue,
  type InteropOptimizerOpportunityDto,
  type InteropOpportunityEffort,
  type InteropParseResult,
  type InteropRecurringObligationDto,
  type InteropSerializationResult,
  type InteropTransactionDto,
  type InteropValidationResult,
} from "./types";

// ---------------------------------------------------------------------------
// Issue collection
// ---------------------------------------------------------------------------

interface Ctx {
  issues: InteropIssue[];
  warnings: InteropIssue[];
  /** "wire" validates ISO strings and revives; "runtime" validates Date instances. */
  mode: "wire" | "runtime";
}

function report(ctx: Ctx, code: string, path: string, message: string, actual?: unknown): void {
  ctx.issues.push({ code, path, message, actual });
}

// ---------------------------------------------------------------------------
// Leaf validators — every reader records an issue instead of throwing
//
// NULL-AS-ABSENCE, deliberately: every optional validator treats `null` the
// same as a missing key. JSON has no `undefined`, so a producer that writes
// `categoryId: null` is expressing absence in JSON's native idiom; rejecting
// it would fail bundles over a spelling difference the wire format itself
// invites. Canonicalization then OMITS absent fields, so `null` never
// round-trips — the canonical bytes have one spelling of absence.
// ---------------------------------------------------------------------------

function requireString(ctx: Ctx, value: unknown, path: string): string {
  if (typeof value === "string") return value;
  report(ctx, "not_string", path, "must be a string", value);
  return "";
}

function optionalString(ctx: Ctx, value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  report(ctx, "not_string", path, "must be a string when present", value);
  return undefined;
}

function requireBool(ctx: Ctx, value: unknown, path: string): boolean {
  if (typeof value === "boolean") return value;
  report(ctx, "not_boolean", path, "must be a boolean", value);
  return false;
}

function optionalBool(ctx: Ctx, value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  report(ctx, "not_boolean", path, "must be a boolean when present", value);
  return undefined;
}

/**
 * Money is an integer count of cents — a fractional or string amount is
 * corruption. SAFE integers only: JSON.parse has already rounded anything
 * beyond 2^53-1, so accepting it would accept a silently different amount.
 */
function requireCents(ctx: Ctx, value: unknown, path: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  report(ctx, "not_integer_cents", path, "must be a safe-integer number of cents", value);
  return 0;
}

function optionalCents(ctx: Ctx, value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  report(ctx, "not_integer_cents", path, "must be a safe-integer number of cents when present", value);
  return undefined;
}

/** Required and nullable — the recurring `amountCents` semantics, exactly. */
function requireCentsOrNull(ctx: Ctx, value: unknown, path: string, present: boolean): number | null {
  if (!present) {
    report(ctx, "missing", path, "is required (null for an unknown amount)");
    return null;
  }
  if (value === null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  report(ctx, "not_integer_cents", path, "must be a safe-integer number of cents or null", value);
  return null;
}

function requireFiniteNumber(ctx: Ctx, value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  report(ctx, "not_number", path, "must be a finite number", value);
  return 0;
}

function oneOf<T extends string>(ctx: Ctx, value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  report(ctx, "not_in_enum", path, `must be one of ${allowed.join(", ")}`, value);
  return allowed[0]!;
}

function stringArray(ctx: Ctx, value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    report(ctx, "not_array", path, "must be an array of strings", value);
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    out.push(requireString(ctx, value[i], `${path}[${i}]`));
  }
  return out;
}

/**
 * The wire grammar: exactly what the serializer emits (`Date.toISOString()` —
 * `YYYY-MM-DDTHH:mm:ss.sssZ`), plus second-precision, explicit offsets, and
 * the date-only form. NOTHING looser: `new Date("0")` parses as the year
 * 2000 in Node and `new Date("08/15/2026")` is locale/engine-dependent, so an
 * unanchored `new Date(string)` would accept values the contract never
 * defined and mint environment-dependent timestamps from them.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Grammar is not enough: `new Date("2026-02-29")` silently normalizes to
 * March 1 in Node — corrupt wire data becoming a DIFFERENT valid date with no
 * issue raised, the exact silent-coercion class this validator exists to
 * stop. So the calendar components are checked as written, before `new Date`
 * ever sees the string.
 */
function isRealCalendarInstant(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && isLeap ? 29 : DAYS_IN_MONTH[month - 1]!;
  if (day < 1 || day > maxDay) return false;
  if (value.length > 10) {
    const hours = Number(value.slice(11, 13));
    const minutes = Number(value.slice(14, 16));
    const seconds = Number(value.slice(17, 19));
    // Hour 24 and leap seconds are engine-dependent readings, not contract.
    if (hours > 23 || minutes > 59 || seconds > 59) return false;
  }
  return true;
}

/** ISO string (wire) or valid Date (runtime) — nothing else parses as a date. */
function parseDateLeaf(ctx: Ctx, value: unknown): Date | null {
  if (ctx.mode === "runtime") {
    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  }
  if (typeof value !== "string" || !ISO_DATE.test(value) || !isRealCalendarInstant(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function requireDate(ctx: Ctx, value: unknown, path: string): Date {
  const date = parseDateLeaf(ctx, value);
  if (date) return date;
  report(ctx, "invalid_date", path, "must be a parseable date", value);
  return new Date(0);
}

/**
 * Wire mode degrades with a warning; runtime mode records an ISSUE — the
 * producer must not emit corruption for the consumer to degrade.
 */
function optionalDate(ctx: Ctx, value: unknown, path: string): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const date = parseDateLeaf(ctx, value);
  if (date) return date;
  if (ctx.mode === "wire") {
    ctx.warnings.push({
      code: "invalid_optional_date",
      path,
      message: "unparseable optional date degraded to undefined",
      actual: value,
    });
    return undefined;
  }
  report(ctx, "invalid_date", path, "optional date is present but invalid", value);
  return undefined;
}

// ---------------------------------------------------------------------------
// Object walkers — one per DTO, with unknown-key rejection
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES: readonly AccountType[] = [
  "CHECKING",
  "SAVINGS",
  "CREDIT_CARD",
  "LOAN",
  "MORTGAGE",
  "INVESTMENT",
  "CASH",
  "OTHER",
];
const ACCOUNT_STATUSES: readonly InteropAccountStatus[] = [
  "ACTIVE",
  "STALE",
  "RECONNECT_REQUIRED",
  "DISCONNECTED",
  "ERROR",
];
const FREQUENCIES: readonly RecurringFrequency[] = [
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
  "IRREGULAR",
];
const RECURRING_TYPES: readonly RecurringType[] = ["BILL", "SUBSCRIPTION", "PAYCHECK", "TRANSFER", "OTHER"];
const EFFORTS: readonly InteropOpportunityEffort[] = ["LOW", "MEDIUM", "HIGH"];
const TRANSACTION_STATES: readonly TransactionState[] = [
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

function asRecord(ctx: Ctx, value: unknown, path: string): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  report(ctx, "not_object", path, "must be an object", value);
  return null;
}

function rejectUnknownKeys(ctx: Ctx, row: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(row)) {
    if (!allowed.includes(key)) {
      report(ctx, "unknown_property", path === "" ? key : `${path}.${key}`, "is not part of the interop contract");
    }
  }
}

function rows<T>(
  ctx: Ctx,
  value: unknown,
  path: string,
  walk: (ctx: Ctx, row: Record<string, unknown>, path: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    report(ctx, "not_array", path, "must be an array", value);
    return [];
  }
  const out: T[] = [];
  // Numeric iteration, not forEach: forEach SKIPS sparse holes, so
  // `new Array(1)` would validate clean and then serialize as `[null]` —
  // bytes this contract's own parser refuses.
  for (let i = 0; i < value.length; i += 1) {
    const row = asRecord(ctx, value[i], `${path}[${i}]`);
    if (row) out.push(walk(ctx, row, `${path}[${i}]`));
  }
  return out;
}

const ACCOUNT_KEYS = [
  "providerAccountId",
  "displayName",
  "officialName",
  "mask",
  "type",
  "subtype",
  "currencyCode",
  "status",
  "lastSuccessfulSyncAt",
  "includeInNetWorth",
] as const;

function walkAccount(ctx: Ctx, row: Record<string, unknown>, path: string): InteropAccountDto {
  rejectUnknownKeys(ctx, row, path, ACCOUNT_KEYS);
  return {
    providerAccountId: requireString(ctx, row.providerAccountId, `${path}.providerAccountId`),
    displayName: requireString(ctx, row.displayName, `${path}.displayName`),
    officialName: optionalString(ctx, row.officialName, `${path}.officialName`),
    mask: optionalString(ctx, row.mask, `${path}.mask`),
    type: oneOf(ctx, row.type, `${path}.type`, ACCOUNT_TYPES),
    subtype: optionalString(ctx, row.subtype, `${path}.subtype`),
    currencyCode: requireString(ctx, row.currencyCode, `${path}.currencyCode`),
    status: oneOf(ctx, row.status, `${path}.status`, ACCOUNT_STATUSES),
    lastSuccessfulSyncAt: optionalDate(ctx, row.lastSuccessfulSyncAt, `${path}.lastSuccessfulSyncAt`),
    includeInNetWorth: optionalBool(ctx, row.includeInNetWorth, `${path}.includeInNetWorth`),
  };
}

const BALANCE_KEYS = ["providerAccountId", "currentCents", "availableCents", "currencyCode", "capturedAt"] as const;

function walkBalance(ctx: Ctx, row: Record<string, unknown>, path: string): InteropBalanceDto {
  rejectUnknownKeys(ctx, row, path, BALANCE_KEYS);
  return {
    providerAccountId: requireString(ctx, row.providerAccountId, `${path}.providerAccountId`),
    currentCents: requireCents(ctx, row.currentCents, `${path}.currentCents`),
    availableCents: optionalCents(ctx, row.availableCents, `${path}.availableCents`),
    currencyCode: requireString(ctx, row.currencyCode, `${path}.currencyCode`),
    capturedAt: requireDate(ctx, row.capturedAt, `${path}.capturedAt`),
  };
}

const TRANSACTION_KEYS = [
  "providerTransactionId",
  "providerAccountId",
  "providerPendingTransactionId",
  "transactionDate",
  "authorizedDate",
  "postedAt",
  "amountCents",
  "currencyCode",
  "merchantName",
  "description",
  "isPending",
  "isRemoved",
  "categoryId",
  "state",
] as const;

function walkTransaction(ctx: Ctx, row: Record<string, unknown>, path: string): InteropTransactionDto {
  rejectUnknownKeys(ctx, row, path, TRANSACTION_KEYS);
  return {
    providerTransactionId: requireString(ctx, row.providerTransactionId, `${path}.providerTransactionId`),
    providerAccountId: requireString(ctx, row.providerAccountId, `${path}.providerAccountId`),
    providerPendingTransactionId: optionalString(
      ctx,
      row.providerPendingTransactionId,
      `${path}.providerPendingTransactionId`,
    ),
    transactionDate: requireDate(ctx, row.transactionDate, `${path}.transactionDate`),
    authorizedDate: optionalDate(ctx, row.authorizedDate, `${path}.authorizedDate`),
    postedAt: optionalDate(ctx, row.postedAt, `${path}.postedAt`),
    amountCents: requireCents(ctx, row.amountCents, `${path}.amountCents`),
    currencyCode: requireString(ctx, row.currencyCode, `${path}.currencyCode`),
    merchantName: optionalString(ctx, row.merchantName, `${path}.merchantName`),
    description: optionalString(ctx, row.description, `${path}.description`),
    isPending: requireBool(ctx, row.isPending, `${path}.isPending`),
    isRemoved: optionalBool(ctx, row.isRemoved, `${path}.isRemoved`),
    categoryId: optionalString(ctx, row.categoryId, `${path}.categoryId`),
    state: oneOf(ctx, row.state, `${path}.state`, TRANSACTION_STATES),
  };
}

const CATEGORY_KEYS = ["id", "name", "parentId"] as const;

function walkCategory(ctx: Ctx, row: Record<string, unknown>, path: string): InteropCategoryDto {
  rejectUnknownKeys(ctx, row, path, CATEGORY_KEYS);
  return {
    id: requireString(ctx, row.id, `${path}.id`),
    name: requireString(ctx, row.name, `${path}.name`),
    parentId: optionalString(ctx, row.parentId, `${path}.parentId`),
  };
}

const RECURRING_KEYS = [
  "id",
  "name",
  "merchantNormalized",
  "categoryId",
  "amountCents",
  "frequency",
  "type",
  "isActive",
  "isConfirmed",
  "includeInForecast",
  "nextExpectedDate",
  "accountId",
] as const;

function walkRecurring(ctx: Ctx, row: Record<string, unknown>, path: string): InteropRecurringObligationDto {
  rejectUnknownKeys(ctx, row, path, RECURRING_KEYS);
  return {
    id: requireString(ctx, row.id, `${path}.id`),
    name: requireString(ctx, row.name, `${path}.name`),
    merchantNormalized: optionalString(ctx, row.merchantNormalized, `${path}.merchantNormalized`),
    categoryId: optionalString(ctx, row.categoryId, `${path}.categoryId`),
    amountCents: requireCentsOrNull(ctx, row.amountCents, `${path}.amountCents`, "amountCents" in row),
    frequency: oneOf(ctx, row.frequency, `${path}.frequency`, FREQUENCIES),
    type: oneOf(ctx, row.type, `${path}.type`, RECURRING_TYPES),
    isActive: requireBool(ctx, row.isActive, `${path}.isActive`),
    isConfirmed: requireBool(ctx, row.isConfirmed, `${path}.isConfirmed`),
    includeInForecast: requireBool(ctx, row.includeInForecast, `${path}.includeInForecast`),
    nextExpectedDate: optionalDate(ctx, row.nextExpectedDate, `${path}.nextExpectedDate`),
    accountId: optionalString(ctx, row.accountId, `${path}.accountId`),
  };
}

const OPPORTUNITY_KEYS = [
  "id",
  "type",
  "title",
  "statement",
  "estMonthlySavingsCents",
  "confidence",
  "effort",
  "evidenceIds",
  "assumptions",
] as const;

function walkOpportunity(ctx: Ctx, row: Record<string, unknown>, path: string): InteropOptimizerOpportunityDto {
  rejectUnknownKeys(ctx, row, path, OPPORTUNITY_KEYS);
  return {
    id: requireString(ctx, row.id, `${path}.id`),
    type: requireString(ctx, row.type, `${path}.type`),
    title: requireString(ctx, row.title, `${path}.title`),
    statement: requireString(ctx, row.statement, `${path}.statement`),
    estMonthlySavingsCents: requireCents(ctx, row.estMonthlySavingsCents, `${path}.estMonthlySavingsCents`),
    confidence: requireFiniteNumber(ctx, row.confidence, `${path}.confidence`),
    effort: oneOf(ctx, row.effort, `${path}.effort`, EFFORTS),
    evidenceIds: stringArray(ctx, row.evidenceIds, `${path}.evidenceIds`),
    assumptions: stringArray(ctx, row.assumptions, `${path}.assumptions`),
  };
}

const ROOT_KEYS = [
  "interopVersion",
  "provider",
  "householdId",
  "exportedAt",
  "accounts",
  "balances",
  "transactions",
  "categories",
  "recurringObligations",
  "optimizerOpportunities",
] as const;

function walkBundle(ctx: Ctx, root: Record<string, unknown>): InteropBundle {
  rejectUnknownKeys(ctx, root, "", ROOT_KEYS);
  const provider = root.provider === "MONEY_MANAGER" ? "MONEY_MANAGER" : undefined;
  if (!provider) report(ctx, "wrong_provider", "provider", 'must be "MONEY_MANAGER"', root.provider);
  return {
    interopVersion: INTEROP_VERSION,
    provider: "MONEY_MANAGER",
    householdId: requireString(ctx, root.householdId, "householdId"),
    exportedAt: requireDate(ctx, root.exportedAt, "exportedAt"),
    accounts: rows(ctx, root.accounts, "accounts", walkAccount),
    balances: rows(ctx, root.balances, "balances", walkBalance),
    transactions: rows(ctx, root.transactions, "transactions", walkTransaction),
    categories: rows(ctx, root.categories, "categories", walkCategory),
    recurringObligations: rows(ctx, root.recurringObligations, "recurringObligations", walkRecurring),
    optimizerOpportunities: rows(ctx, root.optimizerOpportunities, "optimizerOpportunities", walkOpportunity),
  };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Text in, safe runtime bundle out. "Parsed" means validated AND revived —
 * there is no half-valid intermediate step to forget, which is how the last
 * date defect shipped.
 */
export function parseInteropBundleText(text: string): InteropParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      code: "invalid_json",
      issues: [{ code: "invalid_json", path: "", message: String(error) }],
    };
  }

  const ctx: Ctx = { issues: [], warnings: [], mode: "wire" };
  const root = asRecord(ctx, raw, "");
  if (!root) return { ok: false, code: "invalid_bundle", issues: ctx.issues };

  /*
   * Version before structure: a future-version bundle may fail every current
   * structural check, but the useful diagnosis is still "upgrade required",
   * not "corrupt export". A MISSING or non-numeric version cannot name an
   * upgrade path, so that is corruption.
   */
  const version = root.interopVersion;
  if (typeof version !== "number") {
    report(ctx, "missing_version", "interopVersion", "must be a number", version);
    return { ok: false, code: "invalid_bundle", issues: ctx.issues };
  }
  if (version !== INTEROP_VERSION) {
    return {
      ok: false,
      code: "unsupported_version",
      actualVersion: version,
      supportedVersion: INTEROP_VERSION,
      issues: [],
    };
  }

  const bundle = walkBundle(ctx, root);
  if (ctx.issues.length > 0) return { ok: false, code: "invalid_bundle", issues: ctx.issues };
  return { ok: true, bundle, warnings: ctx.warnings };
}

/** In-memory check for producers that build a bundle before serializing it. */
export function validateInteropBundle(value: unknown): InteropValidationResult {
  const ctx: Ctx = { issues: [], warnings: [], mode: "runtime" };
  const root = asRecord(ctx, value, "");
  if (root) {
    if (typeof root.interopVersion !== "number" || root.interopVersion !== INTEROP_VERSION) {
      report(ctx, "wrong_version", "interopVersion", `must be ${INTEROP_VERSION}`, root.interopVersion);
    }
    walkBundle(ctx, root);
  }
  if (ctx.issues.length > 0) return { ok: false, code: "invalid_bundle", issues: ctx.issues };
  return { ok: true };
}

/**
 * Validate, then emit the CANONICAL bytes: explicit field order, ISO dates,
 * two-space indent, one trailing newline. The wire object is rebuilt field by
 * field rather than stringifying the caller's object, so key order can never
 * depend on how the producer happened to construct it. Returning a result
 * (not a bare string) makes producer-side validation unavoidable — the exact
 * boundary weakness this contract exists to remove.
 */
export function serializeInteropBundle(bundle: InteropBundle): InteropSerializationResult {
  const validated = validateInteropBundle(bundle);
  if (!validated.ok) return validated;

  const iso = (date: Date | undefined): string | undefined => date?.toISOString();
  const wire: InteropBundleWire = {
    interopVersion: bundle.interopVersion,
    provider: bundle.provider,
    householdId: bundle.householdId,
    exportedAt: bundle.exportedAt.toISOString(),
    accounts: bundle.accounts.map((a) => ({
      providerAccountId: a.providerAccountId,
      displayName: a.displayName,
      officialName: a.officialName,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      currencyCode: a.currencyCode,
      status: a.status,
      lastSuccessfulSyncAt: iso(a.lastSuccessfulSyncAt),
      includeInNetWorth: a.includeInNetWorth,
    })),
    balances: bundle.balances.map((b) => ({
      providerAccountId: b.providerAccountId,
      currentCents: b.currentCents,
      availableCents: b.availableCents,
      currencyCode: b.currencyCode,
      capturedAt: b.capturedAt.toISOString(),
    })),
    transactions: bundle.transactions.map((t) => ({
      providerTransactionId: t.providerTransactionId,
      providerAccountId: t.providerAccountId,
      providerPendingTransactionId: t.providerPendingTransactionId,
      transactionDate: t.transactionDate.toISOString(),
      authorizedDate: iso(t.authorizedDate),
      postedAt: iso(t.postedAt),
      amountCents: t.amountCents,
      currencyCode: t.currencyCode,
      merchantName: t.merchantName,
      description: t.description,
      isPending: t.isPending,
      isRemoved: t.isRemoved,
      categoryId: t.categoryId,
      state: t.state,
    })),
    categories: bundle.categories.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId,
    })),
    recurringObligations: bundle.recurringObligations.map((o) => ({
      id: o.id,
      name: o.name,
      merchantNormalized: o.merchantNormalized,
      categoryId: o.categoryId,
      amountCents: o.amountCents,
      frequency: o.frequency,
      type: o.type,
      isActive: o.isActive,
      isConfirmed: o.isConfirmed,
      includeInForecast: o.includeInForecast,
      nextExpectedDate: iso(o.nextExpectedDate),
      accountId: o.accountId,
    })),
    optimizerOpportunities: bundle.optimizerOpportunities.map((opp) => ({
      id: opp.id,
      type: opp.type,
      title: opp.title,
      statement: opp.statement,
      estMonthlySavingsCents: opp.estMonthlySavingsCents,
      confidence: opp.confidence,
      effort: opp.effort,
      evidenceIds: [...opp.evidenceIds],
      assumptions: [...opp.assumptions],
    })),
  };

  return { ok: true, text: `${JSON.stringify(wire, null, 2)}\n` };
}
