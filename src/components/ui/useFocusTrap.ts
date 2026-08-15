"use client";

import { useEffect, type RefObject } from "react";

/**
 * Everything inside the trap a keyboard can land on.
 *
 * ONE selector, because the traps a reader meets across the family must agree
 * on what "focusable" means.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A selector match still is not a boundary if the user cannot see it: focusing
 * a `display:none` element is a no-op, so an invisible first/last either
 * swallows the arm-time focus or lets Tab walk straight out of the overlay.
 *
 * `checkVisibility()` rather than the `offsetParent !== null` filter `Sheet`'s
 * inline trap used to carry: `offsetParent` is always `null` under jsdom, so
 * that filter silently emptied the list in tests and every Tab press parked on
 * the panel instead of cycling — the wrap behaviour was untestable. In a
 * browser, `checkVisibility` is ancestor-aware and catches
 * `display:none`/`visibility:hidden` wherever they come from. jsdom (as of 25)
 * does not implement it, so the fallback asks computed style directly — which
 * under jsdom sees the element's OWN `display`/`visibility` (and inherited
 * `visibility`), but not a `display:none` ancestor. That asymmetry is
 * acceptable on purpose: tests hide elements inline, browsers get the full
 * answer, and an unstyled element is visible in both worlds.
 */
function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style ? style.display !== "none" && style.visibility !== "hidden" : true;
}

export interface FocusTrapOptions {
  /** Trap while true; release and restore focus when it goes false or unmounts. */
  active: boolean;
  /** The overlay whose focusables the trap cycles through. */
  containerRef: RefObject<HTMLElement | null>;
  /** Focus lands back here when the trap releases — normally the trigger. */
  returnFocusRef: RefObject<HTMLElement | null>;
  /** Called on Escape. Must be stable, or the trap re-arms on every render. */
  onEscape: () => void;
}

/**
 * Trap focus inside an open overlay: move focus in, keep Tab and Shift+Tab
 * cycling within it, close on Escape, lock body scroll, and return focus to the
 * trigger on release.
 *
 * THE ONE FOCUS TRAP (R2-5a). This behaviour used to exist three times —
 * Cadence's `useFocusTrap`, Money Manager's verbatim copy of it (deliberate,
 * R2-1), and an inline version inside this package's `Sheet` — because a
 * "close enough" re-implementation of a focus trap is how sibling apps end up
 * with different keyboard behaviour for the same gesture. The hook is the
 * BEHAVIOUR alone, no chrome: `Sheet` consumes it for its titled slide-over,
 * and the apps consume it for nav drawers where wrapping a `Sheet` around the
 * primary navigation would add a second heading and a second close affordance.
 *
 * Focus returns to an EXPLICITLY PASSED element rather than to whatever was
 * focused when the trap opened. A nav drawer closes on route change, and by
 * then the link the reader tapped has unmounted — "restore the previously
 * focused element" would drop focus to `<body>` and strand a keyboard user at
 * the top of a page they just navigated to. A caller that does want the
 * previously-focused element (as `Sheet` does) captures it into a ref before
 * the trap arms and passes that.
 */
export function useFocusTrap({
  active,
  containerRef,
  returnFocusRef,
  onEscape,
}: FocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Read once, on arm: by the time the cleanup runs the ref may have been
    // detached, and there would be nowhere to send focus.
    const returnTo = returnFocusRef.current;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);

    (focusables()[0] ?? container).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      // Re-queried on every Tab rather than captured once: the overlay's
      // contents can change while it is open (a launcher renders and removes a
      // menu, a switcher opens a confirmation), and a stale list would let
      // focus escape.
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      body.style.overflow = previousOverflow;
      returnTo?.focus();
    };
  }, [active, containerRef, returnFocusRef, onEscape]);
}
