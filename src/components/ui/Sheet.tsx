"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";
import { useFocusTrap } from "./useFocusTrap.js";

const EXIT_MS = 200;

export interface SheetProps {
  open: boolean;
  /** Called with the requested open state. `false` on Escape, overlay, or close button. */
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  side?: "right" | "left";
  children: ReactNode;
  className?: string;
}

/**
 * Accessible slide-over sheet built with plain React + Tailwind (no external
 * dependency). Focus-trapped, closes on Escape or overlay click, locks body
 * scroll, and returns focus to the trigger on close.
 *
 * The only surface in the kit that gets `lift-3`. Elevation is a scale, not a
 * decoration: cards rest at 1 and rise to 2, so an overlay that genuinely
 * floats above the whole page needs the step above that or it reads as just
 * another card that happens to be on the right.
 *
 * The scrim tints with `foreground` rather than black, so it dims the page in
 * the ink hue in light and lifts it in dark — inverting with the ground the
 * same way every other token does.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = "right",
  children,
  className,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Drive enter/exit transitions without unmounting mid-animation.
  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Capture the return target BEFORE the trap arms. Effects run in declaration
  // order, so this reads the trigger while it still has focus; the hook then
  // reads the ref once, on arm. Declared ahead of `useFocusTrap` on purpose —
  // swapping them hands the trap a stale (or null) return target.
  useEffect(() => {
    if (open && rendered) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
    }
  }, [open, rendered]);

  // Focus management, scroll lock, and key handling while open — the shared
  // trap (R2-5a), not a Sheet-private variant of it.
  const handleEscape = useCallback(() => onOpenChange(false), [onOpenChange]);
  useFocusTrap({
    active: open && rendered,
    containerRef: panelRef,
    returnFocusRef: previouslyFocused,
    onEscape: handleEscape,
  });

  if (!mounted || !rendered) return null;

  const isRight = side === "right";

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={() => onOpenChange(false)}
        className={cn(
          "absolute inset-0 bg-foreground/25 backdrop-blur-xs transition-opacity duration-200 ease-out-expo",
          "motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 flex w-full max-w-md flex-col bg-card shadow-lift-3 outline-hidden",
          "transition-transform duration-200 ease-out-expo motion-reduce:transition-none",
          isRight ? "right-0 border-l border-border" : "left-0 border-r border-border",
          visible ? "translate-x-0" : isRight ? "translate-x-full" : "-translate-x-full",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-muted/40 p-5">
          <div className="flex flex-col gap-1">
            <h2
              id={titleId}
              className="text-base font-semibold tracking-tight text-balance text-card-foreground"
            >
              {title}
            </h2>
            {description ? (
              <p id={descId} className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:border-rule-2 hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
