/**
 * The ONE focus trap (R2-5a).
 *
 * Before this hook, the family carried three implementations of the same
 * keyboard contract: Cadence's `useFocusTrap`, Money Manager's verbatim copy of
 * it (deliberate, R2-1), and the inline trap inside this package's `Sheet`.
 * These tests pin the contract the apps' copies shipped with, so consuming the
 * shared hook is a move and not a rewrite:
 *
 *   - focus moves IN when the trap arms, to the first focusable (or the
 *     container itself when there is none);
 *   - Tab and Shift+Tab cycle within the container, re-querying the DOM on
 *     every keystroke so contents that change while open cannot leak focus;
 *   - Escape calls the caller back (the caller owns closing);
 *   - body scroll is locked while armed and restored on release;
 *   - focus returns to an EXPLICITLY PASSED element on release — not to
 *     `document.activeElement` at arm time, which may have unmounted by then.
 */

import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";

import { useFocusTrap } from "@/components/ui/useFocusTrap";

function Harness({
  active,
  onEscape = () => {},
  withFocusables = true,
}: {
  active: boolean;
  onEscape?: () => void;
  withFocusables?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const [extra, setExtra] = useState(false);
  useFocusTrap({ active, containerRef, returnFocusRef, onEscape });
  return (
    <div>
      <button ref={returnFocusRef}>trigger</button>
      <button onClick={() => setExtra(true)}>grow</button>
      {active ? (
        <div ref={containerRef} tabIndex={-1} data-testid="overlay">
          {withFocusables ? (
            <>
              <button>first</button>
              <button>middle</button>
              {extra ? <button>added</button> : null}
              <button data-grow onClick={() => setExtra(true)}>
                last
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves focus to the first focusable when it arms", () => {
    render(<Harness active />);
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("wraps Tab from the last focusable to the first, and Shift+Tab back", async () => {
    const user = userEvent.setup();
    render(<Harness active />);

    screen.getByRole("button", { name: "last" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "last" })).toHaveFocus();
  });

  it("re-queries the focusables on every Tab, so content added while open joins the cycle", async () => {
    const user = userEvent.setup();
    render(<Harness active />);

    // Grow the overlay from inside it, then Tab from the element that used to
    // be last. A trap that captured its list once would wrap; the real
    // boundary has moved.
    await user.click(screen.getByRole("button", { name: "last" }));
    screen.getByRole("button", { name: "added" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "last" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();
  });

  it("skips invisible focusables when arming and at the Tab boundaries", async () => {
    // A hidden element that matches the selector must not become the trap's
    // first/last: focusing it is a no-op in a browser, so an invisible
    // boundary either swallows the arm-time focus or lets Tab walk out of the
    // overlay entirely. Inline display:none is used because it is the form of
    // hiding jsdom's computed style resolves (jsdom has no checkVisibility;
    // the hook's fallback reads getComputedStyle).
    function HiddenEdges({ onEscape = () => {} }: { onEscape?: () => void }) {
      const containerRef = useRef<HTMLDivElement>(null);
      const returnFocusRef = useRef<HTMLButtonElement>(null);
      useFocusTrap({ active: true, containerRef, returnFocusRef, onEscape });
      return (
        <div>
          <button ref={returnFocusRef}>trigger</button>
          <div ref={containerRef} tabIndex={-1}>
            <button style={{ display: "none" }}>hidden first</button>
            <button>visible first</button>
            <button>visible last</button>
            <button style={{ visibility: "hidden" }}>hidden last</button>
          </div>
        </div>
      );
    }

    const user = userEvent.setup();
    render(<HiddenEdges />);

    expect(screen.getByRole("button", { name: "visible first" })).toHaveFocus();

    screen.getByRole("button", { name: "visible last" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "visible first" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "visible last" })).toHaveFocus();
  });

  it("prefers the element's own checkVisibility() and asks it about the visibility property", async () => {
    // jsdom has no checkVisibility, so the browser branch only runs when the
    // element provides one — this pins both that it wins over computed style
    // and that it is asked about `visibility`, which a bare checkVisibility()
    // call does not check.
    const user = userEvent.setup();
    render(<Harness active />);

    const last = screen.getByRole("button", { name: "last" });
    const seenOptions: unknown[] = [];
    (last as HTMLElement & { checkVisibility: (o?: unknown) => boolean }).checkVisibility = (
      options?: unknown,
    ) => {
      seenOptions.push(options);
      return false;
    };

    // With "last" reporting itself invisible, "middle" is the real boundary.
    screen.getByRole("button", { name: "middle" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();

    expect(seenOptions.length).toBeGreaterThan(0);
    expect(seenOptions[0]).toMatchObject({ checkVisibilityCSS: true, visibilityProperty: true });
  });

  it("parks focus on the container and keeps Tab from escaping when nothing inside is focusable", async () => {
    const user = userEvent.setup();
    render(<Harness active withFocusables={false} />);

    const overlay = screen.getByTestId("overlay");
    expect(overlay).toHaveFocus();
    await user.tab();
    expect(overlay).toHaveFocus();
  });

  it("calls onEscape on Escape and does not close on other keys", () => {
    const onEscape = vi.fn();
    render(<Harness active onEscape={onEscape} />);

    fireEvent.keyDown(document, { key: "Enter" });
    expect(onEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while armed and restores the previous value on release", () => {
    document.body.style.overflow = "scroll";
    const { rerender } = render(<Harness active />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Harness active={false} />);
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("returns focus to the passed element on release, not to whatever was focused at arm time", () => {
    const { rerender } = render(<Harness active={false} />);
    // Arm the trap while focus sits on a DIFFERENT element than the declared
    // return target: release must prefer the declared target.
    screen.getByRole("button", { name: "grow" }).focus();
    rerender(<Harness active />);
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus();

    rerender(<Harness active={false} />);
    expect(screen.getByRole("button", { name: "trigger" })).toHaveFocus();
  });

  it("does nothing while inactive", () => {
    document.body.style.overflow = "";
    const onEscape = vi.fn();
    render(<Harness active={false} onEscape={onEscape} />);

    expect(document.body.style.overflow).toBe("");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});
