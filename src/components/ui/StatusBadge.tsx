import { type ReactNode } from "react";
import {
  ShieldCheck,
  Eye,
  Bell,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../../lib/utils/cn.js";

/** Canonical money-status values used across the briefing. */
export type MoneyStatus = "SAFE" | "WATCH" | "ACTION_NEEDED" | "DATA_STALE";

type StatusConfig = {
  label: string;
  Icon: LucideIcon;
  /** Pill: tinted background + border + token text. */
  pill: string;
  /** Accent text/icon color for larger surfaces. */
  accentText: string;
  /** Tinted masthead band across the top of the status card. */
  band: string;
};

const STATUS: Record<MoneyStatus, StatusConfig> = {
  SAFE: {
    label: "Safe",
    Icon: ShieldCheck,
    pill: "border-safe/30 bg-safe/10 text-safe",
    accentText: "text-safe",
    band: "bg-safe/10",
  },
  WATCH: {
    label: "Watch",
    Icon: Eye,
    pill: "border-watch/30 bg-watch/10 text-watch",
    accentText: "text-watch",
    band: "bg-watch/10",
  },
  ACTION_NEEDED: {
    // Calm indigo/blue — deliberately NOT red. This is a prompt, not an alarm.
    label: "Action needed",
    Icon: Bell,
    pill: "border-action/30 bg-action/10 text-action",
    accentText: "text-action",
    band: "bg-action/10",
  },
  DATA_STALE: {
    label: "Data stale",
    Icon: Clock,
    pill: "border-stale/30 bg-stale/10 text-stale",
    accentText: "text-stale",
    band: "bg-stale/10",
  },
};

export interface StatusBadgeProps {
  status: MoneyStatus;
  /** Override the default text label if a shorter/longer phrasing is needed. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * The money-status indicator. Color, icon, and a text label are ALWAYS shown
 * together — status is never conveyed by color alone (WCAG 2.2 AA).
 */
export function StatusBadge({ status, label, size = "md", className }: StatusBadgeProps) {
  const { label: defaultLabel, Icon, pill } = STATUS[status];
  const text = label ?? defaultLabel;
  const sizing = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        pill,
        sizing,
        className,
      )}
    >
      <Icon aria-hidden className={iconSize} />
      <span>{text}</span>
    </span>
  );
}

export interface StatusCardProps {
  status: MoneyStatus;
  title: string;
  description?: string;
  /** Override the badge label text. */
  statusLabel?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * Larger status surface for the briefing hero: a tinted masthead band carrying
 * the status glyph and the StatusBadge, over a calm body holding the headline
 * and supporting copy.
 *
 * The band replaces the `border-l-4` accent rail this used to wear. The rail
 * was the single most template-looking pattern in the kit — a 4px stripe down
 * the left edge is the default "callout card" of every admin dashboard ever
 * shipped, and it carried the status in colour and position alone, so it added
 * nothing a screen reader or a monochrome display could use. The band earns its
 * tint by holding something: the glyph and the labelled badge sit IN it.
 *
 * The glyph is deliberately a size larger than the badge's own icon rather than
 * a duplicate of it. It is the visual anchor of the masthead; the badge is the
 * text label, which is what makes the status readable without colour. Both are
 * required — dropping the badge's icon to avoid the repetition would break the
 * never-colour-alone rule the badge exists to enforce.
 */
export function StatusCard({
  status,
  title,
  description,
  statusLabel,
  children,
  className,
}: StatusCardProps) {
  const { Icon, accentText, band } = STATUS[status];

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-lift-2",
        className,
      )}
    >
      <div className={cn("flex items-center gap-3 border-b border-border px-5 py-2.5", band)}>
        <Icon aria-hidden className={cn("h-5 w-5 shrink-0", accentText)} />
        <StatusBadge status={status} label={statusLabel} size="sm" />
      </div>
      <div className="flex flex-col gap-2 p-5">
        <h2 className="text-xl font-semibold leading-tight tracking-tight text-balance text-card-foreground">
          {title}
        </h2>
        {description ? (
          <p className="max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}
