import { type HTMLAttributes } from "react";
import { cn } from "../../lib/utils/cn.js";

/**
 * How bad is it. A ramp, ordered — `info` is the neutral floor, `critical` the
 * top step. Distinct from `MoneyStatus` (what state is the money in) and from
 * `BadgeVariant` (what kind of label is this).
 */
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface SeverityBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  severity?: Severity;
}

/**
 * The ladder escalates through the family's RESERVED status ramp rather than
 * through a rainbow: neutral, caution, caution with a firmer edge, danger as a
 * tint, danger as a fill.
 *
 * `medium` separates from `low` by EDGE weight instead of a second hue, which
 * keeps the fill light enough for the text on it to stay above 4.5:1 — an orange
 * dark enough to distinguish from yellow is not.
 *
 * `info` is the neutral floor, deliberately NOT the action-blue that
 * `Badge variant="info"` wears. On this axis `info` means "nothing to escalate"
 * ("Lowest cost", "3 strategies"), and tinting it would make the floor of the
 * ramp look like a step on it. That collision is the reason severity is its own
 * component instead of five more `Badge` variants.
 *
 * Contrast on the tinted grounds, both themes: low/medium 4.8-6.3:1,
 * high 6.1-6.3:1, critical 7.4-7.8:1. The tokens re-step for dark on their own,
 * so there are no `dark:` overrides here.
 */
const RAMP: Record<Severity, string> = {
  info: "border-border bg-muted text-muted-foreground",
  low: "border-watch/25 bg-watch/8 text-watch",
  medium: "border-watch/50 bg-watch/12 text-watch",
  high: "border-danger/30 bg-danger/10 text-danger",
  critical: "border-danger bg-danger text-danger-foreground",
};

/**
 * Severity indicator: a pill whose colour escalates with how bad the thing is.
 *
 * The colour is emphasis, never the message — the caller's children carry the
 * text ("Cap hit", "Balance growing", "62%"), so the badge stays readable
 * without colour, on a monochrome display, and to a screen reader. There is no
 * default label: a severity with nothing to say is not a badge.
 *
 * For money STATE use `StatusBadge`; for a plain label or count use `Badge`.
 */
export function SeverityBadge({
  severity = "info",
  className,
  ...props
}: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        RAMP[severity],
        className,
      )}
      {...props}
    />
  );
}
