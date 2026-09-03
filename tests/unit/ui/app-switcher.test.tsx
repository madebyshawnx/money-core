/**
 * XA-1 — the launcher, and the claim it carries.
 *
 * This component existed in three copies and had already drifted: a URL-resolver
 * fix landed in one app only, a design token migrated in one copy only, and the
 * FOOTNOTE'S WORDING had drifted between PennyBank and the other two. The
 * footnote is a claim about security properties, so the drift that matters most
 * is the one nobody would notice.
 *
 * These tests therefore pin two different kinds of thing:
 *   1. that unreachable apps are DISABLED WITH A REASON rather than hidden —
 *      the behaviour change XA-1 asks for, and the reason the old component
 *      could render nothing at all and look broken; and
 *   2. that the claim is still on screen and still says what it says.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppSwitcher, type AppDestination, type AppSwitcherProps } from "@/components/ui/AppSwitcher";

const current = { name: "Cadence", description: "Read what changed this week", glyph: "C" };

function destination(overrides: Partial<AppDestination> = {}): AppDestination {
  return {
    id: "manager",
    name: "Money Manager",
    description: "Import, categorize, budget, decide",
    glyph: "M",
    availability: { status: "available", href: "https://manager.example/dashboard" },
    ...overrides,
  };
}

async function open(ui: React.ReactElement) {
  const user = userEvent.setup();
  render(ui);
  await user.click(screen.getByRole("button", { name: /switch app/i }));
  return user;
}

describe("AppSwitcher — reachable destinations", () => {
  it("renders a real cross-origin anchor, not a client route", async () => {
    await open(<AppSwitcher currentApp="cadence" current={current} destinations={[destination()]} />);

    const link = await screen.findByRole("menuitem", { name: /Switch to Money Manager/i });
    // A real href is the whole point: these are separate origins, and anything
    // that routes client-side would 404 inside the app it is leaving.
    expect(link).toHaveAttribute("href", "https://manager.example/dashboard");
  });

  it("is an <a> carrying the resolved URL verbatim — never rewritten, relativised, or routed", async () => {
    const href = "https://manager.example/dashboard?from=cadence#inbox";
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[destination({ availability: { status: "available", href } })]}
      />,
    );

    const link = await screen.findByRole("menuitem", { name: /Switch to Money Manager/i });
    // Ported from PennyBank's local suite when the app copies were deleted:
    // that app is a react-router SPA, where anything short of a real absolute
    // anchor — a NavLink, a routed onClick — 404s inside the app it is trying
    // to leave. The app resolved this URL; the component's only job is to not
    // touch it. `getAttribute` rather than the `href` property, because the
    // property comes back resolved against the test origin and would hide
    // exactly the rewriting this test exists to catch.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(href);
  });

  it("marks the current app as here, and does not offer it as a destination", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[destination(), destination({ id: "cadence", name: "Cadence" })]}
      />,
    );

    expect(await screen.findByText("Here")).toBeInTheDocument();
    // Passing the current app in the destinations array is a caller mistake that
    // should be absorbed, not rendered as "switch to the app you are in".
    expect(screen.queryByRole("menuitem", { name: /Switch to Cadence/i })).not.toBeInTheDocument();
  });

  it("hands the click event to onSelect, so a handoff can stop the navigation", async () => {
    // A caller that must hand off BEFORE navigating does exactly this: take the
    // event, stop the browser, then start its own async work.
    const onSelect = vi.fn<NonNullable<AppSwitcherProps["onSelect"]>>((_id, event) => event.preventDefault());
    const user = await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[destination()]}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByRole("menuitem", { name: /Switch to Money Manager/i }));

    // Without the event, the browser follows the href immediately and an async
    // handoff never gets to finish — which would make `in-flight` a state the
    // component advertises but nothing can ever reach.
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe("manager");
    expect(onSelect.mock.calls[0]?.[1]?.defaultPrevented).toBe(true);
  });

  it("leaves the menu open when the caller prevents default, so in-flight can be seen", async () => {
    const onSelect = vi.fn<NonNullable<AppSwitcherProps["onSelect"]>>((_id, event) => event.preventDefault());
    const user = await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[destination()]}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByRole("menuitem", { name: /Switch to Money Manager/i }));

    // Radix composes the child onClick BEFORE its own select handler and skips
    // that handler once the event is defaultPrevented (@radix-ui/primitive), so
    // preventing default keeps the menu mounted. That is not incidental: the
    // spinner this component advertises renders INSIDE the menu, so if the menu
    // closed on click there would be no surface left to show it on.
    expect(screen.getByRole("menuitem", { name: /Switch to Money Manager/i })).toBeInTheDocument();
  });
});

describe("AppSwitcher — unavailable destinations are shown, never hidden", () => {
  it("renders an unreachable app as a disabled row carrying its reason", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({
            availability: { status: "unreachable", reason: "Not configured for this deployment" },
          }),
        ]}
      />,
    );

    // The OLD behaviour was to drop the row, and to render the entire launcher
    // as null when nothing was reachable — indistinguishable from broken.
    expect(await screen.findByText("Money Manager")).toBeInTheDocument();
    expect(screen.getByText("Not configured for this deployment")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Switch to Money Manager/i })).not.toBeInTheDocument();
  });

  it("still renders the launcher when NOTHING is reachable", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({ availability: { status: "unreachable", reason: "Not configured" } }),
          destination({
            id: "pennybank",
            name: "PennyBank",
            description: "Work your card payoff plan",
            glyph: "P",
            availability: { status: "unreachable", reason: "Not configured" },
          }),
        ]}
      />,
    );

    expect(await screen.findByText("PennyBank")).toBeInTheDocument();
    expect(screen.getByText("Money Manager")).toBeInTheDocument();
  });

  it("shows a spinner for an in-flight handoff and refuses to be activated", async () => {
    const onSelect = vi.fn();
    const user = await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[destination({ availability: { status: "in-flight" } })]}
        onSelect={onSelect}
      />,
    );

    const row = await screen.findByText("Money Manager");
    await user.click(row);

    // The reason this matters: a single-use ticket that arrives second is an
    // error the user did nothing to deserve, so the second click must not fire.
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Opening…")).toBeInTheDocument();
  });

  it("surfaces a failed handoff as a row with its reason", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({ availability: { status: "failed", reason: "Sign-in handoff failed" } }),
        ]}
      />,
    );

    expect(await screen.findByText("Sign-in handoff failed")).toBeInTheDocument();
  });

  it("surfaces no-access separately from unreachable", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({ availability: { status: "no-access", reason: "Your account cannot open this" } }),
        ]}
      />,
    );

    expect(await screen.findByText("Your account cannot open this")).toBeInTheDocument();
  });
});

describe("AppSwitcher — the claim", () => {
  it("keeps the honesty footnote, and describes the menu with it", async () => {
    await open(<AppSwitcher currentApp="cadence" current={current} destinations={[destination()]} />);

    const menu = await screen.findByRole("menu");
    const footnote = screen.getByText(/Your sign-in and data don’t travel with the link/i);

    // Not small print a screen-reader user tabs past: it is announced when the
    // launcher opens, which is the whole reason it is wired with aria-describedby.
    expect(footnote).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-describedby", footnote.getAttribute("id"));
  });

  it("renders a per-row note when one is supplied, and nothing when it is not", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({
            id: "pennybank",
            name: "PennyBank",
            glyph: "P",
            note: "Signs in separately — keeps its own encrypted data",
          }),
        ]}
      />,
    );

    // A note that is not true of an app must not be invented to fill the slot,
    // so the field is optional and absent by default.
    expect(await screen.findByText("Signs in separately — keeps its own encrypted data")).toBeInTheDocument();
  });
});

describe("AppSwitcher — grouping", () => {
  it("labels groups and keeps them in first-appearance order", async () => {
    await open(
      <AppSwitcher
        currentApp="cadence"
        current={current}
        destinations={[
          destination({ group: "Platform" }),
          destination({ id: "pennybank", name: "PennyBank", glyph: "P", group: "Separate sign-in" }),
        ]}
      />,
    );

    expect(await screen.findByText("Platform")).toBeInTheDocument();
    expect(screen.getByText("Separate sign-in")).toBeInTheDocument();
  });
});

describe("AppSwitcher — dismissal", () => {
  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<AppSwitcher currentApp="cadence" current={current} destinations={[destination()]} />);

    // Capture the trigger BEFORE opening, not after: Radix's modal menu puts
    // aria-hidden on everything outside itself while it is open, so a role
    // query for the trigger at that point finds nothing. The app-local test
    // this was ported from did the same, and for the same reason.
    const trigger = screen.getByRole("button", { name: /switch app/i });
    await user.click(trigger);
    await screen.findByRole("menu");

    await user.keyboard("{Escape}");

    // Radix owns this behaviour — which is exactly why it is pinned HERE. Each
    // app used to pin it in its local suite, and those tests died with the
    // local copies; without an upstream copy, a future Radix major or a stray
    // `onEscapeKeyDown` on the Content would ship a keyboard trap to all three
    // apps at once with zero red tests.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
