/**
 * The one API addition Phase 8 makes to the kit: `Button`'s `render` prop.
 *
 * It exists because Money Manager had already grown a second component
 * (`components/dashboard/ActionLink.tsx`) that copy-pasted Button's
 * BASE/VARIANTS/SIZES constants purely to put the button shape on an anchor.
 * These tests pin the behaviour that lets that file be deleted, and pin the two
 * things that would make the escape hatch worse than the workaround: emitting
 * invalid nested interactive content, and losing the focus indicator.
 */

import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "@/components/ui/Button";

describe("Button without `render`", () => {
  it("still emits a <button> that defaults to type=button", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });

    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });

  it("still forwards its ref to the button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "Save" }));
  });
});

describe("Button with `render`", () => {
  it("renders the given element instead of a button, with no nested button", () => {
    const { container } = render(
      // eslint-disable-next-line jsx-a11y/anchor-has-content
      <Button render={<a href="/import" />}>Import</Button>,
    );

    const link = screen.getByRole("link", { name: "Import" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/import");
    // `<a><button/></a>` is invalid content and is the whole reason this exists.
    expect(container.querySelector("button")).toBeNull();
  });

  it("carries the variant, size and focus indicator onto the rendered element", () => {
    render(
      <Button render={<a href="/x" />} variant="secondary" size="sm">
        Go
      </Button>,
    );
    const className = screen.getByRole("link", { name: "Go" }).className;

    expect(className).toContain("border-ink-3"); // secondary
    expect(className).toContain("h-8"); // sm
    expect(className).toMatch(/focus-visible:outline-2\b/);
  });

  it("does not forward type= onto a non-button element", () => {
    // `type` on an anchor means "MIME hint", not "submit" — forwarding the
    // Button default would be quietly wrong markup.
    render(<Button render={<a href="/x" />}>Go</Button>);
    expect(screen.getByRole("link", { name: "Go" })).not.toHaveAttribute("type");
  });

  it("lets the rendered element's own className win the merge", () => {
    render(
      <Button render={<a href="/x" className="h-auto" />} size="md">
        Go
      </Button>,
    );
    const className = screen.getByRole("link", { name: "Go" }).className;

    expect(className).toContain("h-auto");
    expect(className).not.toContain("h-10");
  });

  it("keeps the caller's className between the variant and the element's own", () => {
    render(
      <Button render={<a href="/x" />} className="px-0">
        Go
      </Button>,
    );
    const className = screen.getByRole("link", { name: "Go" }).className;

    expect(className).toContain("px-0");
    expect(className).not.toContain("px-4");
  });

  it("forwards handlers and arbitrary props to the rendered element", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      // A hash href: jsdom refuses to navigate anywhere else and logs a
      // "not implemented" error that has nothing to do with what is asserted.
      <Button render={<a href="#go" />} onClick={onClick} aria-describedby="hint">
        Go
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("aria-describedby", "hint");
    await user.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("prefers the rendered element's own children when it has them", () => {
    render(<Button render={<a href="/x">From the element</a>}>From the button</Button>);

    expect(screen.getByRole("link", { name: "From the element" })).toBeInTheDocument();
    expect(screen.queryByText("From the button")).toBeNull();
  });

  it("rejects a non-element render value rather than rendering nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      // @ts-expect-error — deliberately violating the type to prove the guard.
      render(<Button render="just a string">Go</Button>),
    ).toThrow(/single React element/);
    spy.mockRestore();
  });
});
