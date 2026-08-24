import { useId, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils/cn.js";

/**
 * The app launcher — move between the apps in the family.
 *
 * WHY THIS IS IN THE PACKAGE (XA-1)
 * ---------------------------------
 * There were three copies of this component — Cadence, Money Manager and
 * PennyBank — and they had already drifted. Cadence extracted its URL resolver
 * after a hardcoded `http://localhost:3001` shipped to production; Money
 * Manager's copy still carried that literal. Cadence adopted the
 * `tracking-eyebrow` token; Money Manager's copy still had the raw value. The
 * same 18.5rem cap carried two different explanations, and the footnote's
 * wording had drifted between PennyBank and the other two.
 *
 * That last one is why this matters more than ordinary duplication: **this
 * component makes a claim about security properties.** A claim maintained in
 * three places becomes false in one of them, and the copy that goes stale is
 * the one nobody is looking at. There is one copy now.
 *
 * WHAT STAYS IN THE APPS
 * ----------------------
 * URL resolution, and nothing else. It CANNOT live here: Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at build time by textual substitution, so the read
 * must be a full static literal in the app's own source, while PennyBank is a
 * Vite SPA reading `import.meta.env.VITE_*`. A shared module cannot do either on
 * an app's behalf. So each app resolves its own origins and passes finished
 * `destinations` in.
 *
 * That injection is also what lets this component tell the truth. Previously an
 * unreachable app was simply absent from the array, so the launcher could only
 * HIDE it — and when no app was reachable it rendered nothing at all, which is
 * indistinguishable from being broken. Availability is now a value ON a
 * destination, so "not deployed here" can be shown as a disabled row with a
 * reason instead of a silence.
 *
 * SCOPE — this is navigation ONLY. It does not carry a session or any data
 * across. Each app holds its own session on its own origin. Making that
 * genuinely seamless is an auth and data problem (XA-3/XA-4), not a link
 * problem, and this component must not imply it is solved. That is what the
 * footnote says, in the user's words, and it stays until it stops being true.
 */

export type AppId = "manager" | "cadence" | "pennybank";

/**
 * Why a destination can or cannot be used right now.
 *
 * Everything except `available` renders as a DISABLED ROW CARRYING ITS REASON,
 * never as an omission. A launcher that quietly drops rows teaches the reader
 * that the family is smaller than it is.
 */
export type AppAvailability =
  /** Reachable. `href` is the fully-resolved cross-origin destination. */
  | { status: "available"; href: string }
  /** No origin configured for this deployment, so there is nowhere to go. */
  | { status: "unreachable"; reason: string }
  /** Reachable, but this person cannot open it. */
  | { status: "no-access"; reason: string }
  /**
   * A handoff is in progress. Renders a spinner and is NOT activatable — which
   * is the point: without it a double-click mints two tickets, and a single-use
   * ticket that arrives second is an error the user did nothing to deserve.
   */
  | { status: "in-flight" }
  /** A handoff was attempted and failed. The app owns the real error page; this is the row. */
  | { status: "failed"; reason: string };

export interface AppDestination {
  id: AppId;
  name: string;
  /** One-line purpose. Why you would go there, not what it is built with. */
  description: string;
  /** Single serif character used as the app's mark. */
  glyph: string;
  /**
   * A truthful per-row note, shown under the description — e.g. PennyBank's
   * "Signs in separately — keeps its own encrypted data". Optional, because a
   * note that is not true of a given app must not be invented to fill the slot.
   */
  note?: string;
  /**
   * Section heading this row belongs under. Rows are grouped in the order the
   * groups first appear. Supplied by the app rather than hardcoded here,
   * because whether two apps share a sign-in is a fact about the deployment,
   * and this component must not assert it on the app's behalf.
   */
  group?: string;
  availability: AppAvailability;
}

export interface AppSwitcherProps {
  /** The app this launcher is rendering inside. */
  currentApp: AppId;
  /** How to present the current app in the trigger and the "Here" row. */
  current: Pick<AppDestination, "name" | "description" | "glyph">;
  /** Every OTHER app in the family, reachable or not. */
  destinations: AppDestination[];
  /**
   * Called when a destination is activated. An app that needs to start a
   * handoff before navigating uses this and flips that row to `in-flight`;
   * an app that just wants a link can omit it and let the anchor do its job.
   */
  onSelect?: (id: AppId) => void;
}

/** Shared geometry for both kinds of row, so "Here" and a destination align. */
const ROW =
  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-hidden transition-colors duration-150 motion-reduce:transition-none";

/** The app's mark. Serif, on the accent wash — the same figure treatment money gets. */
const GLYPH =
  "flex shrink-0 items-center justify-center rounded-[7px] border border-primary/20 bg-accent-wash font-serif leading-none text-primary";

function isAvailable(d: AppDestination): d is AppDestination & { availability: { status: "available"; href: string } } {
  return d.availability.status === "available";
}

/** The reason text for anything that is not `available`, or null when it is. */
function unavailableReason(availability: AppAvailability): string | null {
  switch (availability.status) {
    case "available":
      return null;
    case "in-flight":
      return "Opening…";
    default:
      return availability.reason;
  }
}

function RowBody({
  destination,
  trailing,
}: {
  destination: AppDestination;
  trailing?: ReactNode;
}) {
  const reason = unavailableReason(destination.availability);
  return (
    <>
      <span aria-hidden className={cn(GLYPH, "mt-0.5 h-[26px] w-[26px] text-[13px]")}>
        {destination.glyph}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
          <span className="truncate">{destination.name}</span>
          {trailing}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">{destination.description}</span>
        {destination.note ? (
          <span className="text-[11px] leading-snug text-ink-3">{destination.note}</span>
        ) : null}
        {reason ? <span className="text-[11px] leading-snug text-ink-3">{reason}</span> : null}
      </span>
    </>
  );
}

export function AppSwitcher({ currentApp, current, destinations, onSelect }: AppSwitcherProps) {
  const footnoteId = useId();

  // Group in first-appearance order. An undefined group keeps its rows in a
  // single unlabelled section, which is what a two-app deployment wants.
  const groups: { label: string | undefined; rows: AppDestination[] }[] = [];
  for (const destination of destinations) {
    if (destination.id === currentApp) continue;
    const existing = groups.find((g) => g.label === destination.group);
    if (existing) existing.rows.push(destination);
    else groups.push({ label: destination.group, rows: [destination] });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Current app: ${current.name}. Switch app`}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5",
          "text-left text-sm font-semibold text-card-foreground shadow-lift-1",
          "transition-[border-color,box-shadow] duration-150 ease-out-expo motion-reduce:transition-none",
          "hover:border-rule-2 hover:shadow-lift-2",
          "data-[state=open]:border-primary data-[state=open]:shadow-lift-2",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        <span aria-hidden className={cn(GLYPH, "h-5 w-5 rounded-[5px] text-[11px]")}>
          {current.glyph}
        </span>
        <span className="min-w-0 flex-1 truncate">{current.name}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-3 w-3 shrink-0 text-ink-3 transition-transform duration-200 ease-out-expo",
            "group-data-[state=open]:rotate-180 motion-reduce:transition-none",
          )}
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={7}
          aria-describedby={footnoteId}
          className={cn(
            // The cap is for the drawer: the launcher also renders inside a
            // 256px off-canvas panel, and 18.5rem of popover on a 320px screen
            // would hang off the edge before Radix's collision handling could
            // shift it back.
            "z-50 w-[18.5rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-card p-1.5 shadow-lift-3",
            "data-[state=open]:animate-menu-in motion-reduce:animate-none",
          )}
        >
          <DropdownMenu.Label className="px-2.5 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">
            Apps in this workspace
          </DropdownMenu.Label>

          {/*
           * The app you are already in. Disabled because there is nowhere to
           * go — it is here to say which app this is, not to be activated.
           * Full contrast on purpose: it is current, not unavailable.
           */}
          <DropdownMenu.Item disabled aria-current="page" className={cn(ROW, "cursor-default")}>
            <RowBody
              destination={{ ...current, id: currentApp, availability: { status: "available", href: "" } }}
              trailing={
                <span className="shrink-0 rounded border border-primary/25 bg-accent-wash px-1.5 text-[9px] font-bold uppercase leading-[1.45] tracking-[0.07em] text-primary">
                  Here
                </span>
              }
            />
          </DropdownMenu.Item>

          {groups.map((group) => (
            <div key={group.label ?? "__ungrouped"}>
              {group.label ? (
                <DropdownMenu.Label className="px-2.5 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">
                  {group.label}
                </DropdownMenu.Label>
              ) : null}

              {group.rows.map((destination) =>
                isAvailable(destination) ? (
                  <DropdownMenu.Item key={destination.id} asChild onSelect={() => onSelect?.(destination.id)}>
                    <a
                      href={destination.availability.href}
                      aria-label={`Switch to ${destination.name} — ${destination.description}`}
                      className={cn(ROW, "data-[highlighted]:bg-muted")}
                    >
                      <RowBody destination={destination} />
                    </a>
                  </DropdownMenu.Item>
                ) : (
                  /*
                   * Disabled, and STILL RENDERED. The app exists; it is just not
                   * openable from here right now, and the row says why. Omitting
                   * it would teach the reader the family is smaller than it is —
                   * and when nothing was reachable the old component rendered
                   * nothing at all, which reads as broken rather than as
                   * unconfigured.
                   */
                  <DropdownMenu.Item
                    key={destination.id}
                    disabled
                    aria-disabled
                    className={cn(ROW, "cursor-default opacity-60")}
                  >
                    <RowBody
                      destination={destination}
                      trailing={
                        destination.availability.status === "in-flight" ? (
                          <Loader2
                            aria-hidden
                            className="h-3 w-3 shrink-0 animate-spin text-ink-3 motion-reduce:animate-none"
                          />
                        ) : undefined
                      }
                    />
                  </DropdownMenu.Item>
                ),
              )}
            </div>
          ))}

          {/*
           * The honesty footnote. `aria-describedby` on the menu, so it is
           * announced when the launcher opens rather than being small print a
           * screen-reader user tabs past. A slicker control must not imply the
           * apps are more connected than they are.
           */}
          <p
            id={footnoteId}
            className="mt-1.5 border-t border-border px-2.5 pb-1 pt-2 text-[11px] leading-snug text-ink-3"
          >
            Switching opens the app at its own address. Your sign-in and data don&rsquo;t travel with
            the link.
          </p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
