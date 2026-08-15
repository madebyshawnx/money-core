/**
 * Sheet's keyboard contract, pinned across the R2-5a refactor.
 *
 * Sheet used to carry its own inline focus trap — the third implementation of
 * the behaviour in the family. These tests pin what a keyboard user actually
 * gets so the move to the shared `useFocusTrap` is observable as a refactor.
 *
 * THE TAB-WRAP TEST WAS RED BEFORE THE REFACTOR, and that is the finding that
 * justifies it: the inline trap filtered focusables by `offsetParent !== null`,
 * and `offsetParent` is always `null` under jsdom, so the filter silently
 * emptied the list and every Tab press parked focus on the panel instead of
 * cycling. The shared hook dropped that filter deliberately (its container
 * only exists while open, so every match is on screen) — meaning the
 * consolidation is not just deduplication, it makes Sheet's trap testable at
 * all.
 */

import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sheet } from "@/components/ui/Sheet";

function Host({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        open sheet
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Details" description="About this item">
        <button>alpha</button>
        <button>omega</button>
      </Sheet>
    </div>
  );
}

describe("Sheet focus behaviour", () => {
  it("moves focus into the panel when it opens", async () => {
    render(<Host />);
    // First focusable inside the panel is the header's close button.
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());
  });

  it("wraps Tab from the last focusable back to the first", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    screen.getByRole("button", { name: "omega" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "omega" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    render(<Host />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns focus to the element that was focused before it opened", async () => {
    const user = userEvent.setup();
    render(<Host initiallyOpen={false} />);

    const trigger = screen.getByRole("button", { name: "open sheet" });
    await user.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("locks body scroll while open and restores it on close", async () => {
    document.body.style.overflow = "scroll";
    render(<Host />);
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.body.style.overflow).toBe("scroll"));
    document.body.style.overflow = "";
  });

  it("calls onOpenChange(false) — the caller owns the close — rather than closing itself", async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Pinned">
        <button>only</button>
      </Sheet>,
    );
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Uncontrolled by the mock: the dialog stays until the owner flips `open`.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
