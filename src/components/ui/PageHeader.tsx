import { type ReactNode } from "react";
import { Clock } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Right-aligned actions (buttons, links, badges). */
  actions?: ReactNode;
  /**
   * Freshness line, e.g. "Updated 2 hours ago". Rendered with a clock icon.
   * Surfacing data freshness is a first-class part of every screen.
   */
  lastUpdated?: string;
  className?: string;
}

/**
 * Standard screen header: an <h1>, optional subtitle, optional right-aligned
 * actions, and an optional "last updated" freshness line. Uses a semantic
 * <header> landmark so screens stay navigable.
 *
 * Nothing here is raised. The header is the masthead of the page, not an object
 * on it — every card below can lift off the paper precisely because this does
 * not. Hierarchy comes from scale and measure instead: a tight-tracked title
 * against a 62-character subtitle, then the freshness line dropped a full step
 * below both.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  lastUpdated,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-2.5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {lastUpdated ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock aria-hidden className="h-3.5 w-3.5" />
          <span>{lastUpdated}</span>
        </p>
      ) : null}
    </header>
  );
}
