/**
 * Token discipline for the kit, asserted against the SOURCE.
 *
 * The rule: a primitive names a semantic token (`bg-card`, `text-safe`,
 * `border-ink-3`) and never a raw colour. The tokens themselves live in each
 * consuming app's `app/globals.css`, which is what lets Cadence and Money
 * Manager re-theme without forking a component — and it only holds if nothing
 * here bakes a colour in.
 *
 * The defect really shipped: `Button`'s destructive variant was `bg-red-700`,
 * a stock palette colour that could not re-step for the dark ground.
 *
 * The apps run the equivalent scan against the BUILT files in their
 * node_modules, which catches the same rule on the other side of the boundary.
 * Both are cheap and they fail for different reasons.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const UI_SRC = resolve(__dirname, "../../../src/components/ui");

function uiSources(): { file: string; text: string }[] {
  return readdirSync(UI_SRC)
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(UI_SRC, file), "utf8") }));
}

describe("kit source — token discipline", () => {
  it("finds the kit it claims to be scanning", () => {
    // A scan over an empty directory is a green test that proves nothing.
    expect(uiSources().length).toBeGreaterThanOrEqual(14);
  });

  it("names no raw Tailwind palette colour anywhere in the kit", () => {
    const rawPalette =
      /\b(?:bg|text|border|ring|outline|fill|stroke|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

    const offenders = uiSources()
      .filter(({ text }) => rawPalette.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("hard-codes no hex colour anywhere in the kit", () => {
    const offenders = uiSources()
      .filter(({ text }) => /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/i.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("imports nothing through the `@/` alias, which does not survive an unbundled build", () => {
    // The UI half is transpiled file-by-file to preserve `"use client"`, and
    // esbuild never resolves tsconfig paths in that mode — an aliased import
    // would be copied through verbatim and fail to resolve in the consumer.
    const offenders = uiSources()
      .filter(({ text }) => /from\s+"@\//.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("declares `use client` on exactly the client modules: two stateful primitives and the focus-trap hook", () => {
    const client = uiSources()
      .filter(({ text }) => /^\s*["']use client["']/.test(text))
      .map(({ file }) => file)
      .sort();

    expect(client).toEqual(["EvidenceDrawer.tsx", "Sheet.tsx", "useFocusTrap.ts"]);
  });
});
