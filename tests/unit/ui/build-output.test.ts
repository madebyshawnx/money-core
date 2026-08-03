/**
 * The build contract for the UI half of this package.
 *
 * These assertions are about the FILES THAT SHIP, not about the sources. Every
 * property here is invisible in `src/` and would fail silently in a consumer:
 *
 *   - `"use client"` is a directive esbuild is free to drop when it bundles.
 *     If it goes missing, `Sheet` and `EvidenceDrawer` are treated as server
 *     components by the Next 15 App Router and blow up on `useState` — at
 *     runtime, in the consumer, with a stack trace that points at Next rather
 *     than here.
 *   - The inverse is just as bad and much easier to do by accident: hoisting
 *     the directive to the whole kit (a `banner`, or bundling everything into
 *     one `ui.js`) makes `<Card>` in a server page ship client JS. That is not
 *     an error anywhere — it is just quietly worse, forever.
 *   - Extensionless relative specifiers resolve under Vite and under webpack's
 *     CommonJS rules, and fail under webpack's ESM rules, which is what a
 *     `"type": "module"` package gets. The apps' `next build` is the only place
 *     that surfaces it.
 *
 * `npm run verify` therefore builds BEFORE it tests. If `dist/` is missing this
 * file fails loudly rather than skipping: a build assertion that opts out when
 * there is no build is not an assertion.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const UI_DIST = resolve(__dirname, "../../../dist/components/ui");
const DIRECTIVE = '"use client"';

/** The two primitives that hold React state and therefore must be client. */
const CLIENT_MODULES = ["Sheet.js", "EvidenceDrawer.js"];

let built: { file: string; text: string }[] = [];

beforeAll(() => {
  expect(
    existsSync(UI_DIST),
    `no build output at ${UI_DIST} — run \`npm run build\` before \`npm test\``,
  ).toBe(true);

  built = readdirSync(UI_DIST)
    .filter((f) => f.endsWith(".js"))
    .map((file) => ({ file, text: readFileSync(join(UI_DIST, file), "utf8") }));
});

describe("built UI output", () => {
  it("emits one module per primitive rather than one bundle", () => {
    // 13 primitives + the barrel. A bundled build would collapse these.
    expect(built.map((b) => b.file).sort()).toEqual(
      [
        "Badge.js",
        "Button.js",
        "Callout.js",
        "Card.js",
        "ConfidenceMeter.js",
        "DataTable.js",
        "EmptyState.js",
        "EvidenceDrawer.js",
        "PageHeader.js",
        "SeverityBadge.js",
        "Sheet.js",
        "StatTile.js",
        "StatusBadge.js",
        "index.js",
      ].sort(),
    );
  });

  it.each(CLIENT_MODULES)("keeps the \"use client\" directive at the top of %s", (file) => {
    const found = built.find((b) => b.file === file);
    expect(found, `${file} was not built`).toBeDefined();

    // Position matters: a directive is only a directive in the prologue.
    const firstStatement = found!.text.trimStart().split("\n")[0]!.trim();
    expect(firstStatement).toMatch(/^["']use client["'];?$/);
  });

  it("does NOT mark the server-safe primitives as client modules", () => {
    // The failure this catches is silent: a `banner` or a bundled entry would
    // make every primitive client-side and nothing would error.
    const leaked = built
      .filter((b) => !CLIENT_MODULES.includes(b.file))
      .filter((b) => b.text.includes(DIRECTIVE))
      .map((b) => b.file);

    expect(leaked).toEqual([]);
  });

  it("keeps the barrel itself a server module so a Card costs no client JS", () => {
    const barrel = built.find((b) => b.file === "index.js")!;
    expect(barrel.text).not.toContain(DIRECTIVE);
    // …while still routing the client components through their own boundary.
    expect(barrel.text).toContain("./Sheet.js");
    expect(barrel.text).toContain("./EvidenceDrawer.js");
  });

  it("emits fully specified relative imports, as ESM requires", () => {
    const bad: string[] = [];
    for (const { file, text } of built) {
      for (const hit of text.matchAll(/from\s+"(\.[^"]*)"/g)) {
        if (!hit[1]!.endsWith(".js")) bad.push(`${file} → ${hit[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("leaves react and lucide-react external instead of inlining them", () => {
    // An inlined React would give the consumer a second copy and break hooks.
    const button = built.find((b) => b.file === "Button.js")!;
    expect(button.text).toContain('from "react"');

    const badge = built.find((b) => b.file === "StatusBadge.js")!;
    expect(badge.text).toContain('from "lucide-react"');
  });

  it("ships type declarations beside every emitted module", () => {
    const types = new Set(readdirSync(UI_DIST).filter((f) => f.endsWith(".d.ts")));
    for (const { file } of built) {
      expect(types.has(file.replace(/\.js$/, ".d.ts")), `no types for ${file}`).toBe(true);
    }
  });
});
