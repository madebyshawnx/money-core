/**
 * @madebyshawnx/money-core — the canonical financial engines.
 *
 * WHY THIS PACKAGE EXISTS
 * -----------------------
 * These engines were previously copy-pasted between Cadence and Money Manager
 * and kept in sync by a tripwire test that hashed five directories and asserted
 * they were byte-identical. That worked for the five directories it watched and
 * failed for everything else. Drifts it could not see, all found on 2026-07-27:
 *
 *   1. `lib/domain/types.ts` — the file all five engines are BUILT ON — was not
 *      in the hashed set and had silently drifted (Money Manager had gained
 *      `RecurringObligation.categoryId`).
 *   2. The AI safety patterns existed in FIVE divergent copies in PennyBank,
 *      each with a hole no other copy had.
 *   3. The two apps' AppSwitcher pointed at different entry points for the same
 *      destination (`/import` vs `/dashboard`).
 *   4. One app's switcher lacked the other's production null-guard, so a
 *      deployed build would have offered a dead localhost link.
 *   5. The inverse failure: FIXING a policy drift silently broke a downstream
 *      consumer, because the tripwire verifies that files match — nothing
 *      verified that dependents still behave.
 *
 * A versioned dependency replaces byte-comparison with actual sharing, so
 * (1)-(4) become impossible rather than merely detectable, and (5) becomes a
 * visible semver decision instead of a surprise.
 *
 * MONEY IS INTEGER CENTS. Negative = outflow. Every engine here assumes it.
 * PennyBank's payoff engine uses floating-point dollars and must be converted
 * before it can join this package — do not convert only at the boundary, or
 * rounding drift lands inside financial math.
 *
 * ENGINE PURITY: these are pure functions. Callers supply `now`/`asOf`; nothing
 * here reads a clock, generates an id, or performs I/O.
 *
 * THE UI KIT IS NOT RE-EXPORTED HERE. `./ui` is a separate subpath on purpose:
 * this entry is a pure-TypeScript module that a server route, a script or a
 * test can import with no React in the picture, and pulling the components
 * through it would make React a hard requirement of the engines. Import the
 * primitives from `@madebyshawnx/money-core/ui`.
 */

export * from "@/lib/utils/money";
export * from "@/lib/domain/types";

export * as ledger from "@/lib/domain/ledger";
export * as recurring from "@/lib/domain/recurring";
export * as forecast from "@/lib/domain/forecast";
export * as rules from "@/lib/domain/rules";
export * as policy from "@/lib/domain/policy";
export * as freshness from "@/lib/domain/facts/freshness";
export * as interop from "@/lib/interop";
