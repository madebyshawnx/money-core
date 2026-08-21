# @madebyshawnx/money-core

Canonical financial engines **and the shared design-system kit** used by
**Cadence** (read-only weekly briefing), **Money Manager** (interactive
budgeting) and **PennyBank** (credit-card payoff). Cadence and Money Manager
consume the engines; all three consume the UI primitives and the one
design-token sheet. PennyBank keeps its own float-dollars payoff engine (see
"Not yet included").

```
ledger · recurring · forecast · rules · policy · types · money · seed · ui · tokens.css
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

### Versioning policy (MC-1)

The rationale above was unimplemented for the package's first twelve commits:
`0.1.0` throughout, including a public API addition, with no tags. The policy
now is: **every merge to `main` that changes `src/` bumps `version` in the
same PR** (patch for fixes, minor for API additions, major for breaks — the
AI-policy validator's rules count as API), **and the merge commit is tagged
`v<version>`**. Consumption stays SHA-pinned by the three consumers; the
version and tag exist so a human reading a pin, a diff, or a changelog can
tell WHAT KIND of change sits between two pins without reading every commit.
Dep-only and CI-only merges do not bump.

### Build-toolchain pins (MC-4)

Every consumer builds `dist/` at install time (`prepare`) with devDependencies
resolved FRESH against this file's ranges — npm ignores a git dependency's
lockfile. `tsup`, `typescript` and the `esbuild` override are therefore
EXACT-pinned: with ranges, a routine toolchain minor release could break all
three consumer installs at once with no change in any repo. Upgrading the
toolchain is a deliberate pin bump verified by `npm run verify`, never a drive-by
resolution. Test-only devDependencies stay ranged on purpose — they never run
inside a consumer's install.

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

**The design tokens ship here too, as one CSS sheet** — see
[`./tokens.css`](#tokenscss--the-one-design-token-sheet) below. The primitives
only ever name the semantic utilities built on those tokens (`bg-card`,
`text-safe`, `border-ink-3`); the mapping from token to utility (`@theme
inline`) stays in each app, which is what lets an app re-theme without forking
a component. Two things a consumer must do:

1. **Tell Tailwind to scan this package**, or none of the kit's class names are
   emitted and every primitive renders unstyled:
   ```css
   @source "../node_modules/@madebyshawnx/money-core/dist";
   ```
2. **Import the token sheet** (next section). `"use client"` needs nothing from
   the consumer — it is handled here, see below.

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

## `./tokens.css` — the one design-token sheet

`src/styles/tokens.css`, shipped verbatim as `dist/tokens.css` and exported at
`@madebyshawnx/money-core/tokens.css`. One line at the top of the entry
stylesheet, right after Tailwind itself:

```css
@import "tailwindcss";
@import "@madebyshawnx/money-core/tokens.css";
```

Tailwind 4 inlines it at build time. Its resolver honours `exports` under the
`style` condition, so the subpath stays a **plain string** target — a
conditional object would have to name every resolver (Node, Tailwind, Vite).
What the sheet carries:

- the **semantic palette**, in `@layer base` — `--paper`, `--ink`, `--rule`,
  `--accent`, the status ramp (`--safe` / `--watch` / `--action` / `--stale` /
  `--danger`) and the elevation colours (`--lift-1..3`); light on `:root`, dark
  re-stepped on `.dark`, `color-scheme` on both;
- the **Monarch scales**, unlayered — `--gray-1..12`, `--accent-9..11`,
  `--pos` / `--neg` / `--warn`, `--chart-1..8`, surfaces and spacing —
  consumed as arbitrary values (`bg-[var(--gray-2)]`).

What stays in the app: the `@theme inline` block mapping the palette onto
Tailwind utilities (the semantic NAMES differ per app — PennyBank's are
shadcn's), fonts, radii, and any app-local extension declared beside the import
(PennyBank's non-semantic `--series-*` chart ramp). The sheet declares nothing
in `--color-*`, `--font-*`, `--text-*` or `--radius-*`: an unlayered copy
here would outrank the app's own `@theme` value regardless of position.

Two tests, one on each side of the boundary. `tests/unit/tokens/tokens.test.ts`
pins the sheet itself: it ships byte-identical at the exported subpath, it is
tokens and nothing else, both themes are whole and dark is a re-step. Each
consumer's `tests/integration/design-tokens.test.ts` compiles its stylesheet
with the sheet inlined and asserts the result — slash-opacity survives as
`color-mix`, the status ramp stays legible on its own tints, the anchors hold.

Before R2-5 this was three byte-identical copies held in step by discipline
alone — the arrangement the engines were rescued from. Values follow
money-manager `docs/DESIGN_MONARCH_DIRECTION.md` §4 and §6; the dark scale is
derived from Radix dark, not observed on Monarch dark screens (Phase 4
validates it).

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run build       # clean, then tsup -> dist/ (ESM + .d.ts, 10 entry points)
npm test            # vitest (521 tests) — asserts against dist/, so build first
npm run verify      # typecheck, build, test — in that order, deliberately

node scripts/check-consumer-pins.mjs    # MC-3: the three apps pin ONE money-core SHA
node scripts/check-consumer-tokens.mjs  # R2-5: the three apps import THIS token sheet, same installed copy
```

The two `check-consumer-*` scripts are operator checks, not CI: they read the
sibling working trees on the dev machine (the repos are private, so consumer
CI cannot install the git dependency). Run both after any re-pin.

`verify` builds **before** it tests: the `"use client"` assertions are about the
files that ship, and a build assertion that runs against a stale `dist/` is
worse than none.

## Not yet included

**PennyBank's payoff engine.** It uses floating-point dollars
(`currentBalance: number`, no `Cents` type) and must be converted to integer
cents before it can join. Convert the engine itself — **not** only at the
boundary, or rounding drift lands inside financial math.
