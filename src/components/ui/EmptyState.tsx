import { type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";

export interface EmptyStateProps {
  /** Lucide icon for the empty surface. Rendered decoratively (aria-hidden). */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action (e.g. a Button). Kept optional — many screens are read-only. */
  action?: ReactNode;
  className?: string;
}

/**
 * Calm empty / zero-state. Used when a screen has nothing to show yet — a clean
 * inbox, no matching transactions, no confirmed bills. Non-shaming by design:
 * an empty inbox is a good outcome, not a warning.
 *
 * Deliberately the one UNRAISED surface in the kit: a dashed edge on a
 * half-opaque ground, sitting flat on the page. Elevation here would make an
 * empty screen look like a populated one, and every app in this family ships
 * blank — a blank screen means empty data, not a screen still loading, and it
 * should be visibly a placeholder rather than a card with nothing in it.
 *
 * The dashed edge takes `rule-2`, not `border`: at a 50% duty cycle the divider
 * weight all but vanishes and the shape stops reading as a container.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rule-2 bg-card/50 px-6 py-11 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden className="h-5 w-5" />
        </span>
      ) : null}
      <div className="flex max-w-[44ch] flex-col gap-1">
        <p className="text-base font-semibold tracking-tight text-balance text-card-foreground">
          {title}
        </p>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
