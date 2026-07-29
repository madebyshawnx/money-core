import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/utils/cn.js";

/**
 * The base surface. Rests on `lift-1` and rises to `lift-2` under the cursor,
 * with the edge firming from `rule` to `rule-2` at the same time — the shadow
 * says "further from the page", the edge says "in focus". A single flat
 * `shadow-sm` said neither.
 *
 * The 2px rise is `motion-safe:` rather than a `motion-reduce:` undo, so under
 * a reduced-motion preference the transform is never emitted at all instead of
 * relying on utility ordering to cancel it. Colour and elevation still respond,
 * so the hover is still legible without any movement.
 */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl border border-border bg-card text-card-foreground shadow-lift-1",
          "transition-[box-shadow,border-color,transform] duration-200 ease-out-expo",
          "hover:border-rule-2 hover:shadow-lift-2 motion-safe:hover:-translate-y-0.5",
          "motion-reduce:transition-none",
          className,
        )}
        {...props}
      />
    );
  },
);

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return (
      <div ref={ref} className={cn("flex flex-col gap-1 p-5", className)} {...props} />
    );
  },
);

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return (
      <h3
        ref={ref}
        className={cn(
          "text-base font-semibold leading-tight tracking-tight text-balance text-card-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn("max-w-[66ch] text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
});

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />;
  },
);

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-2 border-t border-border px-5 py-3.5",
          className,
        )}
        {...props}
      />
    );
  },
);
