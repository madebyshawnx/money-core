# @madebyshawnx/money-core

Canonical financial engines **and the shared design-system kit** used by
**Cadence** (read-only weekly briefing) and **Money Manager** (interactive
budgeting). PennyBank (credit-card payoff) consumes neither yet — it has its own
component kit and a float-dollars payoff engine.

```
ledger · recurring · forecast · rules · policy · types · money · seed · ui
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

## `./ui` — the Ledger Dispatch kit

Thirteen primitives (Badge, Button, Callout, Card, ConfidenceMeter, DataTable,
EmptyState, EvidenceDrawer, PageHeader, SeverityBadge, Sheet, StatTile,
StatusBadge/StatusCard) plus the `cn` class-merge helper, all from one subpath:

```ts
import { Card, StatusBadge, Button, cn } from "@madebyshawnx/money-core/ui";
```

**The design TOKENS stay in the app.** Each app's `app/globals.css` declares
`--paper`, `--ink`, `--accent`, the status ramp and the elevation stack; the
primitives only ever name the semantic utilities built on them (`bg-card`,
`text-safe`, `border-ink-3`). That is what lets an app re-theme without forking
a component. Two things a consumer must do:

1. **Tell Tailwind to scan this package**, or none of the kit's class names are
   emitted and every primitive renders unstyled:
   ```css
   @source "../node_modules/@madebyshawnx/money-core/dist";
   ```
2. **Nothing.** `"use client"` is handled here — see below.

### Why the UI half is built unbundled

`Sheet` and `EvidenceDrawer` hold React state and carry `"use client"`. The
rest are server components. Bundling the kit into a single `ui.js` forces one
answer for all of them: either esbuild drops the directive and the two client
components crash under the Next 15 App Router, or it is hoisted and a `<Card>`
in a server page starts shipping client JS for no reason.

So the UI entry is built with `bundle: false` — transpiled file by file, one
output module per primitive, directives left attached to the two modules that
declared it. `tests/unit/ui/build-output.test.ts` reads the built files back and
asserts exactly that, in both directions, because both failures are silent.

For the same reason the kit's sources use **relative imports with explicit
`.js` extensions**: esbuild does not resolve the `@/` alias when it is not
bundling, and webpack applies ESM's fully-specified rule to a `"type": "module"`
package.

### Peer vs real dependencies

| Package | Kind | Why |
|---|---|---|
| `react`, `react-dom` | **peer** | Hooks require a single React instance; a second copy in the tree is an immediate `Invalid hook call`. |
| `lucide-react` | **peer** | `LucideIcon` is in this package's PUBLIC types — `EmptyState`, `Callout` and `StatusBadge` take icons as props. Two copies means two nominally different `LucideIcon` types meeting at the boundary. |
| `clsx`, `tailwind-merge` | **real** | Pure string functions, no shared state, absent from the public types. A duplicate would be harmless; making consumers install them to get a working `cn` would not. |

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run build       # clean, then tsup -> dist/ (ESM + .d.ts, 10 entry points)
npm test            # vitest (375 tests) — asserts against dist/, so build first
npm run verify      # typecheck, build, test — in that order, deliberately
```

`verify` builds **before** it tests: the `"use client"` assertions are about the
files that ship, and a build assertion that runs against a stale `dist/` is
worse than none.

## Not yet included

**PennyBank's payoff engine.** It uses floating-point dollars
(`currentBalance: number`, no `Cents` type) and must be converted to integer
cents before it can join. Convert the engine itself — **not** only at the
boundary, or rounding drift lands inside financial math.
