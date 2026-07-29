"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";
import { Sheet } from "./Sheet.js";

export interface EvidenceItem {
  label: string;
  value?: string;
}

export interface EvidenceDrawerProps {
  items: EvidenceItem[];
  title?: string;
  description?: string;
  /** Inline content for the trigger button (text/icon). Defaults to "Show why". */
  trigger?: ReactNode;
  /** Message shown when there are no evidence items. */
  emptyMessage?: string;
  className?: string;
}

/**
 * "Show why" slide-over. Opens a focus-trapped Sheet listing the evidence
 * (label + value pairs) behind a briefing statement.
 *
 * The values are set in the serif money role — these ARE the figures the
 * statement rests on, and showing them in the same face the headline figure
 * uses is what makes the drawer read as evidence rather than as a footnote.
 * Tabular numerals come with the role, so the column lines up on the decimal.
 */
export function EvidenceDrawer({
  items,
  title = "Why this appears",
  description = "The facts this statement is based on.",
  trigger,
  emptyMessage = "No evidence is available for this item yet.",
  className,
}: EvidenceDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Show why: ${title}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-action underline-offset-4",
          "transition-colors hover:text-accent-2 hover:underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className,
        )}
      >
        {trigger ?? (
          <>
            <Info aria-hidden className="h-4 w-4" />
            <span>Show why</span>
          </>
        )}
      </button>

      <Sheet open={open} onOpenChange={setOpen} title={title} description={description}>
        {items.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{emptyMessage}</p>
        ) : (
          <dl className="flex flex-col divide-y divide-border">
            {items.map((item, index) => (
              <div
                key={`${item.label}-${index}`}
                className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"
              >
                <dt className="text-sm text-muted-foreground">{item.label}</dt>
                <dd className="text-right font-serif text-[0.9375rem] text-card-foreground">
                  {item.value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Sheet>
    </>
  );
}
