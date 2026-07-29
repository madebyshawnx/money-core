import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils/cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

/** The props `render` merges into. Anything else on the element is left alone. */
type RenderableProps = {
  className?: string;
  children?: ReactNode;
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Render the button's LOOK on a different element.
   *
   * `<Button render={<Link href="/import" />}>Import</Button>` emits a real
   * anchor wearing the button shape. This exists because navigation that looks
   * like a button is common and the obvious spelling — `<a><button/></a>` — is
   * invalid HTML: an anchor may not contain interactive content, and the
   * nesting breaks keyboard and screen-reader behaviour. Wrapping the button in
   * a `<form action="…">` navigates but announces itself as a form submission,
   * which navigation is not.
   *
   * Money Manager had already grown a parallel `ActionLink` component that
   * copy-pasted this file's BASE/VARIANTS/SIZES constants to work around the
   * gap. Two sources of truth for one button shape is exactly the drift this
   * package exists to end, so the escape hatch belongs here.
   *
   * The rendered element keeps its own props; only `className` is merged, with
   * the element's own classes applied LAST so a call site can still override.
   * `type` is deliberately not forwarded — it is meaningless on an anchor.
   */
  render?: ReactElement<RenderableProps>;
}

/**
 * The focus indicator is an OUTLINE, not a ring. A ring is painted inside the
 * element's own box shadow stack, so it has to be told which ground to offset
 * against (`ring-offset-background` vs `ring-offset-card`) and gets it wrong
 * the moment a button moves onto a different surface. An outline is drawn by
 * the browser outside the border box and is correct everywhere.
 *
 * `outline-ring` resolves to the lighter accent step, which is the only accent
 * value that reads against BOTH the deep accent fill it surrounds on a primary
 * button and the paper behind it.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out-expo " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none";

/**
 * Filled variants lift a single pixel on hover and settle back on press, so the
 * button behaves like a physical key rather than just changing colour. The
 * press state returns to the resting elevation — a control that stayed raised
 * while held would read as stuck.
 *
 * Both filled hovers move toward the LIGHTER step of their hue in both themes,
 * so "hover is brighter" means the same thing whichever ground you are on.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-lift-1 hover:bg-accent-2 hover:shadow-lift-2 " +
    "motion-safe:hover:-translate-y-px active:translate-y-0 active:shadow-lift-1",
  /*
   * The border is `ink-3`, not the `rule-2` the mockup drew. A secondary button
   * is `bg-card` on a `bg-background` page — 1.06:1 — so its BORDER is the only
   * thing delimiting it, and `rule-2` measures 1.6:1 against the card in both
   * themes. A boundary that is the sole identifier of a control is exactly what
   * WCAG 1.4.11 asks for 3:1 on. `ink-3` measures 3.80:1 light / 4.20:1 dark.
   */
  secondary:
    "border border-ink-3 bg-card text-foreground shadow-lift-1 hover:border-ink-2 hover:bg-muted " +
    "hover:shadow-lift-2 motion-safe:hover:-translate-y-px active:translate-y-0 active:shadow-lift-1",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted",
  /*
   * Reserved for irreversible actions (delete/disconnect). Calm, not alarmist.
   *
   * Was painted from Tailwind's stock red-700 — a raw palette colour that
   * ignored the token layer and did not re-step for dark. There is a test that
   * fails if any primitive reaches for the stock palette again.
   *
   * `destructive` is the token (Phase 2 defined it;
   * it had been referenced-but-undefined), so this now carries the authored
   * danger hue and the near-black-on-pink pairing dark needs.
   */
  destructive:
    "bg-destructive text-destructive-foreground shadow-lift-1 hover:brightness-110 " +
    "hover:shadow-lift-2 motion-safe:hover:-translate-y-px active:translate-y-0 active:shadow-lift-1",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

/**
 * Plain, accessible button. Always keyboard-operable with a visible
 * focus-visible outline. No external UI library.
 *
 * Renders a `<button>` unless `render` is given — see the prop's note.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", type = "button", className, render, children, ...props },
  ref,
) {
  const shape = cn(BASE, VARIANTS[variant], SIZES[size], className);

  if (render !== undefined) {
    if (!isValidElement<RenderableProps>(render)) {
      throw new Error("Button: `render` must be a single React element.");
    }
    /*
     * `type` is dropped on purpose (see the prop note). The element's own
     * className goes last so `cn` lets it win, and its own children win too —
     * `<Button render={<Link href="/x">Go</Link>} />` should say "Go" rather
     * than render empty.
     */
    return cloneElement(render, {
      ...props,
      ref,
      className: cn(shape, render.props.className),
      children: render.props.children ?? children,
    } as RenderableProps);
  }

  return (
    <button ref={ref} type={type} className={shape} {...props}>
      {children}
    </button>
  );
});
