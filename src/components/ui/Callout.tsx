import { type ReactNode } from "react";
import { Info, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";

export type CalloutVariant = "info" | "stale" | "warning" | "neutral";

type CalloutConfig = {
  Icon: LucideIcon;
  container: string;
  icon: string;
};

/**
 * A callout is a notice, not a surface — it stays FLAT while cards around it
 * are raised. Elevation in this kit means "this holds content"; spending it on
 * an inline aside would make the page read as a pile of floating boxes.
 *
 * The wash is deliberately lighter than the Badge tint (8% against 10%): the
 * same colour over a paragraph-sized area reads far stronger than over a pill.
 * Icon + text always — colour is never the only signal.
 */
const VARIANTS: Record<CalloutVariant, CalloutConfig> = {
  info: {
    Icon: Info,
    container: "border-action/25 bg-action/8 text-foreground",
    icon: "text-action",
  },
  stale: {
    Icon: Clock,
    container: "border-stale/30 bg-stale/8 text-foreground",
    icon: "text-stale",
  },
  warning: {
    Icon: TriangleAlert,
    container: "border-watch/30 bg-watch/8 text-foreground",
    icon: "text-watch",
  },
  neutral: {
    Icon: Info,
    container: "border-border bg-muted text-foreground",
    icon: "text-muted-foreground",
  },
};

export interface CalloutProps {
  variant?: CalloutVariant;
  /** Optional bold lead-in line. */
  title?: string;
  /** Override the default variant icon. */
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}

/**
 * Inline notice for stale/missing data and stated assumptions. Calm and
 * non-panic — icon + text always, never color alone.
 */
export function Callout({ variant = "info", title, icon, children, className }: CalloutProps) {
  const config = VARIANTS[variant];
  const Icon = icon ?? config.Icon;

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed",
        config.container,
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", config.icon)} />
      <div className="min-w-0">
        {title ? <p className="font-semibold tracking-tight">{title}</p> : null}
        <div className={cn(title && "mt-0.5 text-muted-foreground")}>{children}</div>
      </div>
    </div>
  );
}
