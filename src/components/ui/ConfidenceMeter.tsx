import { cn } from "../../lib/utils/cn.js";

export type ConfidenceLevel = "High" | "Medium" | "Low";

/**
 * `dots` is the inline rendering: five dots plus "94% · High", sized to sit in
 * a table cell or beside a line of body copy.
 *
 * `rule` is the SAME component at hero scale. Five 8px dots parked next to a
 * 72px figure read as an afterthought, so the hero rendering becomes a ruled
 * underline for the figure — full and solid at High, shortened at Medium,
 * short and dotted at Low. Same `score`, same thresholds, same `aria-label`:
 * it is a second rendering, not a second scoring scale, and nothing about the
 * meaning changes with the drawing.
 */
export type ConfidenceVariant = "dots" | "rule";

const DOT_COUNT = 5;
const HIGH_THRESHOLD = 80;
const MEDIUM_THRESHOLD = 50;

/** Map a 0-100 score to a calm text level. Thresholds: >=80 High, >=50 Medium, else Low. */
export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= HIGH_THRESHOLD) return "High";
  if (score >= MEDIUM_THRESHOLD) return "Medium";
  return "Low";
}

const LEVEL_DOT: Record<ConfidenceLevel, string> = {
  High: "bg-safe",
  Medium: "bg-watch",
  Low: "bg-muted-foreground",
};

const LEVEL_TEXT: Record<ConfidenceLevel, string> = {
  High: "text-safe",
  Medium: "text-watch",
  Low: "text-muted-foreground",
};

/**
 * Width carries the level as well as colour, so the rule is still readable in
 * greyscale and to anyone who cannot separate the hues. Low is drawn dotted
 * rather than solid: a broken line is the oldest available way of saying
 * "provisional", and it survives both losing colour and losing width.
 */
const LEVEL_RULE: Record<ConfidenceLevel, string> = {
  High: "w-full bg-safe",
  Medium: "w-2/3 bg-watch",
  // `h-0` wins over the base height via tailwind-merge: the dotted top border
  // IS the line here, so a filled box underneath it would double the stroke.
  Low: "h-0 w-2/5 rounded-none border-t-2 border-dotted border-muted-foreground",
};

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export interface ConfidenceMeterProps {
  /** Confidence score in the range 0-100. */
  score: number;
  size?: "sm" | "md";
  /** Hide the trailing "85% · High" text and rely on the aria-label + dots only. */
  showValue?: boolean;
  /**
   * Which rendering to draw. `dots` (default) is the inline five-dot meter.
   * `rule` draws the same score as an underline sized for a hero figure.
   */
  variant?: ConfidenceVariant;
  className?: string;
}

/**
 * Confidence indicator. Never color-only — the level word and the percentage
 * are always available, and both renderings expose the identical `aria-label`,
 * so which one a screen picks is a purely visual decision.
 */
export function ConfidenceMeter({
  score,
  size = "md",
  showValue = true,
  variant = "dots",
  className,
}: ConfidenceMeterProps) {
  const value = clampScore(score);
  const level = confidenceLevel(value);
  const label = `Confidence: ${value}% (${level})`;
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  const valueText = showValue ? (
    <span className={cn("font-medium tabular-nums", textSize)}>
      <span className="text-foreground">{value}%</span>
      <span aria-hidden className="text-muted-foreground"> · </span>
      <span className={LEVEL_TEXT[level]}>{level}</span>
    </span>
  ) : null;

  if (variant === "rule") {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn("flex w-full flex-col gap-1.5", className)}
      >
        {/*
         * An explicit full-width slot for the rule to be a fraction of. The
         * flex column would stretch the rule on its own, so this is not what
         * makes `w-2/3` work — it is here to keep "the space the confidence is
         * measured against" a separate element from "the rule", which is what a
         * faint full-length track would attach to if one is ever wanted.
         */}
        <span aria-hidden className="block w-full">
          <span
            className={cn(
              "block rounded-full",
              size === "sm" ? "h-px" : "h-0.5",
              LEVEL_RULE[level],
            )}
          />
        </span>
        {valueText}
      </span>
    );
  }

  const filled = Math.round((value / 100) * DOT_COUNT);
  const dotSize = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span aria-hidden className="flex items-center gap-1">
        {Array.from({ length: DOT_COUNT }, (_, index) => (
          <span
            key={index}
            className={cn(
              "rounded-full",
              dotSize,
              index < filled ? LEVEL_DOT[level] : "bg-rule-2",
            )}
          />
        ))}
      </span>
      {valueText}
    </span>
  );
}
