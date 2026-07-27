# @madebyshawnx/money-core

Canonical financial engines shared by **Cadence** (read-only weekly briefing),
**Money Manager** (interactive budgeting), and **PennyBank** (credit-card payoff).

```
ledger · recurring · forecast · rules · policy
```

## Why this exists

These engines were previously copy-pasted between repos and kept in sync by a
tripwire test that hashed five directories and asserted they were byte-identical.
It worked for the five directories it watched, and missed everything else. Found
on 2026-07-27, all invisible to it:

| # | Drift | Why the tripwire missed it |
|---|---|---|
| 1 | `lib/domain/types.ts` gained `RecurringObligation.categoryId` in one repo | The file all five engines are BUILT ON was not in the hashed set |
| 2 | AI safety patterns existed in **five** divergent copies in PennyBank, each with a hole no other copy had | Different repo entirely |
| 3 | The two AppSwitchers pointed at different entry points for the same app (`/import` vs `/dashboard`) | `components/app-shell` is intentionally per-app |
| 4 | One switcher lacked the other's production null-guard — a deployed build would have offered a dead localhost link | Same |
| 5 | Fixing a policy drift silently broke a downstream consumer (`validateOptimizerText` truncated its violation list) | Parity verifies files MATCH; nothing verifies dependents still BEHAVE |
| 6 | `lib/seed/scenarios.ts` — the shared **test fixture corpus** — had drifted | Not in the hashed set, so both suites were green against *different data* |

A versioned dependency makes 1–4 and 6 structurally impossible rather than
merely detectable, and turns 5 into a visible semver decision instead of a
surprise.

## Invariants

- **Money is integer cents.** Negative = outflow. Every engine assumes it.
- **Engines are pure.** Callers supply `now` / `asOf`. Nothing reads a clock,
  generates an id, or performs I/O.
- **`policy` is an AI-safety boundary.** Changes there are human-review-required.

## Extraction technique (important during migration)

`src/` mirrors the apps' directory layout exactly and keeps the `@/` path alias,
so every file was copied **byte-identically with zero import rewriting**. `tsup`
(esbuild) resolves the alias at build time and emits real relative specifiers, so
no alias leaks into published output.

While the apps still hold their copies, this makes divergence checkable with a
plain `diff` — a stronger guarantee than the hash-comparison it replaces:

```bash
diff -r ../money_app/lib/domain/ledger src/lib/domain/ledger
```

## Reconciliation choices

Where the two repos disagreed, the **superset** was adopted (Money Manager's, in
both cases) and verified not to break either suite:

- `domain/types.ts` — includes `RecurringObligation.categoryId`
- `seed/scenarios.ts` — includes the uncategorized `rec_rivera_water_unknown`

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (352 tests)
npm run build       # tsup -> dist/ (ESM + .d.ts, 6 entry points)
npm run verify      # all three
```

## Not yet included

**PennyBank's payoff engine.** It uses floating-point dollars
(`currentBalance: number`, no `Cents` type) and must be converted to integer
cents before it can join. Convert the engine itself — **not** only at the
boundary, or rounding drift lands inside financial math.
