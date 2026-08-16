/**
 * @madebyshawnx/money-core/interop — the MM → Cadence bundle contract (R2-15).
 *
 * One definition of the bundle, validated on BOTH boundaries: the producer
 * serializes through `serializeInteropBundle` (which refuses invalid bundles
 * and owns the canonical bytes), the consumer parses through
 * `parseInteropBundleText` (which owns JSON, structure, the version check and
 * date revival, and returns a result — never a thrown surprise).
 */

export {
  INTEROP_VERSION,
  type InteropAccountDto,
  type InteropAccountStatus,
  type InteropAccountWire,
  type InteropBalanceDto,
  type InteropBalanceWire,
  type InteropBundle,
  type InteropBundleWire,
  type InteropCategoryDto,
  type InteropFailureCode,
  type InteropIssue,
  type InteropOpportunityEffort,
  type InteropOptimizerOpportunityDto,
  type InteropParseResult,
  type InteropRecurringObligationDto,
  type InteropRecurringObligationWire,
  type InteropSerializationResult,
  type InteropTransactionDto,
  type InteropTransactionWire,
  type InteropValidationResult,
} from "./types";

export { parseInteropBundleText, serializeInteropBundle, validateInteropBundle } from "./contract";
