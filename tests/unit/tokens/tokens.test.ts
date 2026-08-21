/**
 * The shared token sheet — `src/styles/tokens.css`, shipped as `dist/tokens.css`
 * and pulled into every consumer's entry stylesheet by one line:
 *
 *   @import "@madebyshawnx/money-core/tokens.css";
 *
 * Why it exists (R2-5). The same ninety-odd hex values lived in three
 * stylesheets — money-manager and Cadence `app/globals.css`, PennyBank
 * `src/index.css` — byte-identical by discipline alone, which is the exact
 * arrangement the engines were rescued from (see `src/index.ts`). This sheet is
 * the one copy. The consumers go on asserting the COMPILED result in their own
 * `tests/integration/design-tokens.test.ts` (slash-opacity survives, the status
 * ramp stays legible, dark is a re-step); this file pins the contract of the
 * SHEET ITSELF, which those tests cannot see once Tailwind has inlined it:
 *
 *   - it ships, byte-identical to the source, at the subpath the package
 *     exports. A consumer reaches it through `exports` — a missing entry or a
 *     stale copy in dist/ is an app with no palette and no error anywhere;
 *   - it declares tokens and nothing else. A stray `@theme` here would add
 *     utilities to every app at once; a `--font-*` or `--radius-*` outside a
 *     layer would silently outrank the app's own `@theme` value, because an
 *     unlayered declaration beats a layered one regardless of where it sits;
 *   - the palette is whole and re-stepped in BOTH themes at the source, so a
 *     half-edited dark block is caught here, before any consumer re-pins.
 *
 * `npm run verify` builds BEFORE it tests. If `dist/tokens.css` is missing this
 * file fails loudly rather than skipping — see `ui/build-output.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const SOURCE = resolve(ROOT, "src/styles/tokens.css");
const SHIPPED = resolve(ROOT, "dist/tokens.css");
const SUBPATH = "./tokens.css";

/** The semantic palette every consumer's `@theme inline` maps its utilities onto. */
const PALETTE = [
  "--paper",
  "--paper-2",
  "--paper-3",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--rule",
  "--rule-2",
  "--accent",
  "--accent-2",
  "--accent-wash",
  "--accent-ink",
  "--safe",
  "--watch",
  "--action",
  "--stale",
  "--danger",
  "--danger-ink",
  "--lift-1",
  "--lift-2",
  "--lift-3",
];

/** The Monarch scales (DESIGN_MONARCH_DIRECTION.md §4), consumed as `var(--gray-2)`. */
const SCALE_LIGHT = [
  ...Array.from({ length: 12 }, (_, i) => `--gray-${i + 1}`),
  "--accent-9",
  "--accent-10",
  "--accent-11",
  "--accent-tint-2",
  "--accent-tint-3",
  ...["pos", "neg", "warn"].flatMap((ramp) => [`--${ramp}-3`, `--${ramp}-9`, `--${ramp}-11`]),
  ...Array.from({ length: 8 }, (_, i) => `--chart-${i + 1}`),
  "--bg-canvas",
  "--bg-card",
  "--border-card",
  ...Array.from({ length: 6 }, (_, i) => `--space-${i + 1}`),
  "--shadow-card",
  "--shadow-pop",
];

/** Dark re-steps only what Radix's dark scale moves; `var(--gray-N)` aliases re-resolve on their own. */
const SCALE_DARK = [
  ...[1, 2, 3, 4, 6, 9, 11, 12].map((n) => `--gray-${n}`),
  "--accent-tint-2",
  "--accent-tint-3",
  ...["pos", "neg", "warn"].flatMap((ramp) => [`--${ramp}-3`, `--${ramp}-9`, `--${ramp}-11`]),
  "--chart-1",
  "--bg-card",
  "--shadow-card",
];

/*
 * Names the sheet must NOT declare. Each is a Tailwind `@theme` namespace the
 * consumers own (`--font-sans` via next/font or @fontsource, `--radius-*`,
 * `--text-*`, `--color-*`); an unlayered copy here would outrank them.
 */
const RESERVED_NAMESPACES = ["--color-", "--font-", "--text-", "--radius-"];

function lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** The sheet minus its comments — the part a browser acts on. */
function rulesOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Brace-counted body of the first `open` at or after `from`. Fails if absent. */
function section(source: string, open: string, from = 0): { body: string; end: number } {
  const at = source.indexOf(open, from);
  expect(at, `no \`${open.trim()}\` block`).toBeGreaterThan(-1);
  let i = at + open.length;
  let depth = 1;
  while (depth > 0 && i < source.length) {
    const ch = source[i++];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return { body: source.slice(at + open.length, i - 1), end: i };
}

/** `--name: value;` pairs (plus the two non-custom properties the sheet sets) out of a block body. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const match = /^\s*(--[\w-]+|color-scheme|font-variant-numeric):\s*(.+?);/.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    out[name] = value.trim();
  }
  return out;
}

// Comments are stripped before any scan: the header quotes the very `@import`
// line a consumer writes, and a palette note cites a hex that was REJECTED.
// Neither is a rule, and a scan that trips on prose would push the prose out.
const source = existsSync(SOURCE) ? rulesOnly(lf(readFileSync(SOURCE, "utf8"))) : "";

describe("tokens.css — the shipped sheet", () => {
  it("exports the sheet at ./tokens.css, resolved into dist/", () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
      files: string[];
      sideEffects: boolean | string[];
    };
    // A plain string target matches every resolver condition — Node's
    // `require.resolve`, Tailwind's enhanced-resolve under `style`, Vite's —
    // where a conditional object would have to name each of them.
    expect(manifest.exports[SUBPATH]).toBe("./dist/tokens.css");
    expect(manifest.files).toContain("dist");
    // The sheet is imported for its side effect alone — it declares custom
    // properties and exports nothing. The consumers reach it through
    // Tailwind's own `@import`, which inlines it before any bundler runs, but
    // a bare `import "…/tokens.css"` from JS would be dropped by a webpack-
    // compatible bundler under the package's `"sideEffects": false`, with no
    // error and no palette. CSS must be named as side-effectful (Codex, R2-5
    // round 2).
    expect(Array.isArray(manifest.sideEffects) ? manifest.sideEffects : []).toContain("*.css");
  });

  it("ships dist/tokens.css byte-identical to the source", () => {
    expect(existsSync(SOURCE), `no source sheet at ${SOURCE}`).toBe(true);
    expect(
      existsSync(SHIPPED),
      `no built sheet at ${SHIPPED} — run \`npm run build\` before \`npm test\``,
    ).toBe(true);
    expect(readFileSync(SHIPPED, "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });
});

describe("tokens.css — what the sheet may contain", () => {
  it("is tokens and nothing else: no imports, no theme, no fonts, no remote origin", () => {
    expect(source.length).toBeGreaterThan(0);
    const banned = [
      "@import",
      "@theme",
      "@source",
      "@font-face",
      "@utility",
      "@custom-variant",
      "@apply",
      "@plugin",
      "@config",
    ];
    for (const atRule of banned) {
      expect(source, `${atRule} does not belong in a token sheet`).not.toContain(atRule);
    }
    expect(source).not.toMatch(/url\(/);
  });

  it("declares nothing in a namespace the consumers' @theme blocks own", () => {
    const declared: string[] = [];
    for (const line of source.split("\n")) {
      const match = /^\s*(--[\w-]+)\s*:/.exec(line);
      if (match?.[1]) declared.push(match[1]);
    }
    // A scan over an empty sheet is a green test that proves nothing.
    expect(declared.length).toBeGreaterThanOrEqual(PALETTE.length * 2 + SCALE_LIGHT.length);
    const offenders = declared.filter((name) => RESERVED_NAMESPACES.some((ns) => name.startsWith(ns)));
    expect(offenders).toEqual([]);
  });

  it("writes every colour as lowercase six-digit hex, the one form the consumers' contrast maths parses", () => {
    const hexes = [...source.matchAll(/#[0-9a-zA-Z]+\b/g)].map((m) => m[0]);
    expect(hexes.length).toBeGreaterThanOrEqual(PALETTE.length * 2);
    expect(hexes.filter((hex) => !/^#[0-9a-f]{6}$/.test(hex))).toEqual([]);
  });
});

describe("tokens.css — the semantic palette, inside @layer base", () => {
  const layer = () => section(source, "@layer base {");
  const light = () => declarations(section(layer().body, "\n  :root {").body);
  const dark = () => {
    const { body } = layer();
    const rootEnd = section(body, "\n  :root {").end;
    // `.dark` MUST follow `:root`: equal specificity, so source order decides.
    return declarations(section(body, "\n  .dark {", rootEnd).body);
  };

  it("declares the palette exactly once, in one @layer base block, :root before .dark", () => {
    expect(source.match(/@layer base \{/g)).toHaveLength(1);
    expect(layer().body.match(/\n  :root \{/g)).toHaveLength(1);
    expect(layer().body.match(/\n {2}\.dark \{/g)).toHaveLength(1);
    expect(layer().body.indexOf("\n  :root {")).toBeLessThan(layer().body.indexOf("\n  .dark {"));
  });

  it("declares the identical raw token set in :root and .dark, plus color-scheme", () => {
    const expected = [...PALETTE, "color-scheme"].sort();
    expect(Object.keys(light()).sort()).toEqual(expected);
    expect(Object.keys(dark()).sort()).toEqual(expected);
    expect(light()["color-scheme"]).toBe("light");
    expect(dark()["color-scheme"]).toBe("dark");
  });

  it("re-steps every dark value instead of reusing light, and never by fading light out", () => {
    const l = light();
    const d = dark();
    for (const token of PALETTE) {
      expect(d[token], `${token} was not re-stepped for dark`).not.toBe(l[token]);
      expect(d[token]).not.toContain("color-mix");
      expect(d[token]).not.toContain("var(");
    }
  });

  it("pins the anchors all three consumers assert against their compiled CSS", () => {
    const l = light();
    const d = dark();
    expect(l["--paper"]).toBe("#fbfaf8");
    expect(l["--ink"]).toBe("#22201d");
    expect(l["--accent"]).toBe("#5b5bd6");
    expect(l["--danger"]).toBe("#a3232b");
    expect(l["--action"]).toBe("#2b57a8");
    expect(d["--paper"]).toBe("#191817");
    expect(d["--ink"]).toBe("#f1efed");
    expect(d["--accent"]).toBe("#b1a9ff");
    expect(d["--danger"]).toBe("#f0868d");
    expect(d["--action"]).toBe("#7fa5e8");
  });
});

describe("tokens.css — the Monarch scales, unlayered", () => {
  // Unlayered on purpose: plain custom properties consumed via arbitrary
  // values (`bg-[var(--gray-2)]`); no utility is generated from them, so there
  // is nothing for a layer to order. They sit AFTER the palette block.
  const afterLayer = () => section(source, "@layer base {").end;
  const light = () => declarations(section(source, "\n:root {", afterLayer()).body);
  const dark = () => {
    const rootEnd = section(source, "\n:root {", afterLayer()).end;
    return declarations(section(source, "\n.dark {", rootEnd).body);
  };

  it("declares the whole light scale and tabular numerals on :root", () => {
    const l = light();
    expect(Object.keys(l).sort()).toEqual([...SCALE_LIGHT, "font-variant-numeric"].sort());
    expect(l["font-variant-numeric"]).toBe("tabular-nums");
    // The aliases resolve through the scale, so dark needs no copy of them.
    expect(l["--bg-canvas"]).toBe("var(--gray-1)");
    expect(l["--border-card"]).toBe("var(--gray-4)");
  });

  it("re-steps exactly the documented dark subset", () => {
    const l = light();
    const d = dark();
    expect(Object.keys(d).sort()).toEqual([...SCALE_DARK].sort());
    for (const token of SCALE_DARK) {
      // Radix yellow-9 is the one step its dark scale leaves where it is
      // (#ffc53d in both); every other re-declared value must actually move.
      if (token === "--warn-9") continue;
      expect(d[token], `${token} was not re-stepped for dark`).not.toBe(l[token]);
    }
    expect(d["--warn-9"]).toBe("#ffc53d");
    expect(d["--bg-card"]).toBe("var(--gray-2)");
    expect(d["--shadow-card"]).toBe("none");
  });

  it("keeps the family accent Radix iris, not Monarch's orange", () => {
    expect(light()["--accent-9"]).toBe("#5b5bd6");
    expect(light()["--gray-1"]).toBe("#fbfaf8");
    expect(light()["--gray-12"]).toBe("#22201d");
    expect(dark()["--gray-1"]).toBe("#191817");
  });
});
