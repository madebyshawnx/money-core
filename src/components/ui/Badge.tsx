import { type HTMLAttributes } from "react";
import { cn } from "../../lib/utils/cn.js";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "muted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/**
 * Every variant is a tinted fill + a firmer edge of the SAME hue, so the pill
 * reads as one object rather than as text sitting on a wash. The edge is the
 * heavier value on purpose: at this size a hairline is what separates a badge
 * from a coloured word.
 *
 * `neutral` borrows `rule-2` rather than `border` — the divider weight
 * disappears against the card it sits on.
 */
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "border-rule-2 bg-card text-foreground",
  info: "border-action/25 bg-action/10 text-action",
  success: "border-safe/25 bg-safe/10 text-safe",
  warning: "border-watch/30 bg-watch/10 text-watch",
  muted: "border-transparent bg-muted text-muted-foreground",
};

/** Small pill for labels and counts. Not a status indicator — use StatusBadge for money status. */
export function Badge({ variant = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
