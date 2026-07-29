import { type ReactNode } from "react";
import { cn } from "../../lib/utils/cn.js";

export type StatTone = "neutral" | "positive" | "caution" | "action";

const TONE_VALUE: Record<StatTone, string> = {
  neutral: "text-foreground",
  positive: "text-safe",
  caution: "text-watch",
  action: "text-action",
};

export interface StatTileProps {
  label: string;
  /** The headline figure (pre-formatted). */
  value: ReactNode;
  /** Optional supporting line under the value. */
  hint?: ReactNode;
  tone?: StatTone;
  className?: string;
}

/**
 * A single at-a-glance figure: a small uppercase label, a large serif value,
 * and an optional hint. Used in the briefing and cash-flow stat rows.
 *
 * The figure is set in the serif money role at regular weight. It is not bold:
 * at this size the serif already supplies the presence, and bolding it as well
 * turns a figure into a shout. Tabular numerals arrive with the role, so a row
 * of tiles keeps its digits on the same vertical rhythm.
 *
 * The label is the quiet half of the pair — small, wide-tracked, and in the
 * muted ink rather than the faintest step, which does not clear AA at this size
 * on either ground.
 */
export function StatTile({ label, value, hint, tone = "neutral", className }: StatTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-lift-1",
        "transition-[box-shadow,border-color,transform] duration-200 ease-out-expo",
        "hover:border-rule-2 hover:shadow-lift-2 motion-safe:hover:-translate-y-0.5",
        "motion-reduce:transition-none",
        className,
      )}
    >
      <span className="text-[0.625rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-serif text-[1.625rem] leading-[1.1] tracking-[-0.02em]",
          TONE_VALUE[tone],
        )}
      >
        {value}
      </span>
      {hint ? (
        <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
