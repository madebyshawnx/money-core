/**
 * The severity primitive the kit was missing.
 *
 * `docs/43_DESIGN_SYSTEM_UNIFICATION.md` §3.1 measured this: PennyBank's local
 * `Badge` is a severity ramp (`info · low · medium · high · critical`) and the
 * shared `Badge` is a general-purpose variant set (`neutral · info · success ·
 * warning · muted`) with no critical or danger step. Mapping one onto the other
 * would collapse `critical`, `high` and `medium` into `warning` across 61 call
 * sites on screens about debt — a green typecheck certifying a worse product.
 *
 * So severity gets its own component rather than five more `Badge` variants, for
 * two concrete reasons beyond tidiness:
 *
 *   1. `info` ALREADY MEANS TWO DIFFERENT THINGS. In the shared `Badge` it is
 *      the action-blue tint; in the severity ramp it is the neutral floor of the
 *      ladder ("Nora's pick", "3 strategies" — deliberately unalarming). One
 *      union carrying both would make the same variant name render two ways
 *      depending on which axis the caller had in mind.
 *   2. Severity and label-variant are orthogonal axes. Merged, the type would
 *      permit `variant="success"` on a risk indicator and `variant="critical"`
 *      on a count pill, and neither is a type error.
 *
 * `StatusBadge` was checked as the possible home and is not one: it models
 * `MoneyStatus` (`SAFE · WATCH · ACTION_NEEDED · DATA_STALE`), a different axis
 * again.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SeverityBadge, type Severity } from "@/components/ui/SeverityBadge";
import { SeverityBadge as BarrelSeverityBadge } from "@/components/ui/index";

const ALL: Severity[] = ["info", "low", "medium", "high", "critical"];

function classesFor(severity: Severity): string {
  const { container } = render(<SeverityBadge severity={severity}>Label</SeverityBadge>);
  return container.firstElementChild!.className;
}

describe("SeverityBadge", () => {
  it("is exported from the kit barrel", () => {
    expect(BarrelSeverityBadge).toBe(SeverityBadge);
  });

  it("renders its children as text, so severity is never carried by colour alone", () => {
    render(<SeverityBadge severity="critical">Cap hit</SeverityBadge>);
    expect(screen.getByText("Cap hit")).toBeInTheDocument();
  });

  it("emits a span pill rather than an interactive element", () => {
    const { container } = render(<SeverityBadge severity="high">Over limit</SeverityBadge>);
    expect(container.firstElementChild!.tagName).toBe("SPAN");
  });

  it("defaults to the neutral floor of the ramp", () => {
    const { container } = render(<SeverityBadge>Nora&apos;s pick</SeverityBadge>);
    expect(container.firstElementChild!.className).toBe(classesFor("info"));
  });

  it("gives every step of the ramp a distinct treatment", () => {
    const seen = new Map<string, Severity>();
    for (const severity of ALL) {
      const className = classesFor(severity);
      expect(
        seen.has(className),
        `${severity} renders identically to ${seen.get(className)}`,
      ).toBe(false);
      seen.set(className, severity);
    }
  });

  it("escalates critical to the danger token, NOT to warning/watch", () => {
    // The forbidden mapping from doc 43 §3.1, asserted rather than trusted.
    const critical = classesFor("critical");
    expect(critical).toContain("bg-danger");
    expect(critical).toContain("text-danger-foreground");
    expect(critical).not.toContain("watch");
  });

  it("keeps high on danger as a tint, so critical stays the only fill", () => {
    const high = classesFor("high");
    expect(high).toContain("text-danger");
    expect(high).not.toContain("watch");
    // A tint, not the fill critical wears.
    expect(high).not.toContain("bg-danger ");
  });

  it("separates medium from low by edge weight on the same hue, not a second hue", () => {
    const low = classesFor("low");
    const medium = classesFor("medium");

    expect(low).toContain("text-watch");
    expect(medium).toContain("text-watch");
    expect(low).not.toBe(medium);
    // The distinguishing step is the border, which is what keeps the fill light
    // enough for the text on it to clear 4.5:1.
    const border = (className: string) => className.match(/border-watch\/\d+/)?.[0];
    expect(border(low)).toBeDefined();
    expect(border(medium)).toBeDefined();
    expect(border(low)).not.toBe(border(medium));
  });

  it("names only semantic tokens, never a raw palette colour", () => {
    for (const severity of ALL) {
      expect(classesFor(severity)).not.toMatch(
        /\b(?:bg|text|border)-(?:red|orange|amber|yellow|slate|gray|zinc)-\d{2,3}\b/,
      );
    }
  });

  it("lets the caller's className through", () => {
    const { container } = render(
      <SeverityBadge severity="low" className="ml-2">
        Committed
      </SeverityBadge>,
    );
    expect(container.firstElementChild!.className).toContain("ml-2");
  });

  it("forwards arbitrary span props, e.g. a title or a test id", () => {
    render(
      <SeverityBadge severity="medium" data-testid="pill" title="Utilization 62%">
        62%
      </SeverityBadge>,
    );
    expect(screen.getByTestId("pill")).toHaveAttribute("title", "Utilization 62%");
  });
});
