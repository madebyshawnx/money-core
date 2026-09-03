/**
 * The shared design-system kit — "Ledger Dispatch".
 *
 * WHY THIS IS IN THE PACKAGE
 * --------------------------
 * These files were previously copy-pasted between Cadence and Money
 * Manager and held together by the same byte-identical tripwire the engines
 * used (`money-manager/tests/integration/engine-parity.test.ts`). That made
 * every restyle a two-repo commit and made a one-repo fix a silent divergence
 * the moment anyone forgot. Now there is one copy.
 *
 * WHAT STAYS IN THE APPS
 * ----------------------
 * The TOKENS. `app/globals.css` in each app still declares `--paper`, `--ink`,
 * `--accent`, the status ramp and the elevation stack. The primitives here name
 * those tokens (`bg-card`, `text-muted-foreground`, `border-safe/25`) and never
 * a raw colour, so an app is free to re-theme without forking a component — and
 * an app that fails to declare a token gets a visibly unstyled primitive rather
 * than a wrong one.
 *
 * Two consequences for consumers, both easy to get wrong:
 *
 *   1. Tailwind must be told to SCAN this package, or none of these class names
 *      end up in the compiled CSS. Add `@source` for the installed dist next to
 *      the app's own roots.
 *   2. `Sheet` and `EvidenceDrawer` are client components. The build preserves
 *      their `"use client"` directives per FILE — which is why the UI half of
 *      this package is emitted unbundled. Everything else here stays a server
 *      component, so importing a `Card` into a server page costs no client JS.
 *
 * App-shell files (AppShell, ThemeToggle) are deliberately NOT here: layout
 * and theme wiring genuinely differ per app. AppSwitcher used to be on that
 * list and moved in (XA-1) for the reason it was the wrong member: its
 * footnote is a claim about security properties, and a claim maintained in
 * three copies goes stale in the copy nobody is looking at. Only URL
 * resolution stays with the apps — Next.js and Vite each inline their env
 * reads at build time by textual substitution, so each app resolves its own
 * origins and passes finished `destinations` in.
 */

export { cn } from "../../lib/utils/cn.js";

export {
  AppSwitcher,
  type AppAvailability,
  type AppDestination,
  type AppId,
  type AppSwitcherProps,
} from "./AppSwitcher.js";
export { Badge, type BadgeProps, type BadgeVariant } from "./Badge.js";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./Button.js";
export { Callout, type CalloutProps, type CalloutVariant } from "./Callout.js";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card.js";
export {
  ConfidenceMeter,
  confidenceLevel,
  type ConfidenceLevel,
  type ConfidenceMeterProps,
  type ConfidenceVariant,
} from "./ConfidenceMeter.js";
export {
  DataTable,
  type ColumnAlign,
  type DataTableColumn,
  type DataTableProps,
} from "./DataTable.js";
export { EmptyState, type EmptyStateProps } from "./EmptyState.js";
export { PageHeader, type PageHeaderProps } from "./PageHeader.js";
export { SeverityBadge, type Severity, type SeverityBadgeProps } from "./SeverityBadge.js";
export { StatTile, type StatTileProps, type StatTone } from "./StatTile.js";
export {
  StatusBadge,
  StatusCard,
  type MoneyStatus,
  type StatusBadgeProps,
  type StatusCardProps,
} from "./StatusBadge.js";

/* Client modules. Their `"use client"` boundary lives in their own file. */
export {
  EvidenceDrawer,
  type EvidenceDrawerProps,
  type EvidenceItem,
} from "./EvidenceDrawer.js";
export { Sheet, type SheetProps } from "./Sheet.js";
export { useFocusTrap, type FocusTrapOptions } from "./useFocusTrap.js";
