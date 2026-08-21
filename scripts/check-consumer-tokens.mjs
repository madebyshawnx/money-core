#!/usr/bin/env node
/**
 * R2-5 — assert the three consumers take their design tokens from THIS
 * package, and that all three have the SAME copy of it installed.
 *
 * The sibling `check-consumer-pins.mjs` (MC-3) measures that the apps pin one
 * money-core SHA. This measures the thing that pin exists to deliver for the
 * token sheet, because a matching pin is not enough on its own:
 *
 *   - an app could pin the right SHA and still carry a local copy of the
 *     palette — the exact drift this slice removed, quietly reintroduced;
 *   - an app could have the right pin in package.json and a stale `dist/` in
 *     node_modules (a re-pin without `npm ci`), so its compiled CSS would be
 *     built from a sheet nobody else has.
 *
 * Three checks per consumer, read from the sibling working trees:
 *   1. the entry stylesheet `@import`s the package sheet;
 *   2. it declares NONE of the names the sheet declares (app-local tokens such
 *      as PennyBank's `--series-*` are fine — they are not in the sheet);
 *   3. the installed `node_modules/@madebyshawnx/money-core/dist/tokens.css`
 *      exists, and its hash matches the other two consumers'.
 *
 * Whether the installed copy also matches this checkout's `src/styles/tokens.css`
 * is REPORTED, not asserted — a deliberate lag behind main is allowed, a split
 * between the apps is not (same rule as the pin check).
 *
 * Operator script, not CI: the repos are private and the consumers' Actions
 * cannot install the git dependency. Run after any re-pin:
 *
 *   node scripts/check-consumer-tokens.mjs
 *
 * Exit 0 on match; exit 1 naming each failure.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@madebyshawnx/money-core";
const IMPORT_LINE = `@import "${PACKAGE}/tokens.css";`;
const SOURCE = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
const CONSUMERS = [
  { name: "money-manager", dir: "C:/dev/money-manager", stylesheet: "app/globals.css" },
  { name: "cadence (money_app)", dir: "C:/dev/money_app", stylesheet: "app/globals.css" },
  { name: "pennybank", dir: "C:/dev/pennybank-app", stylesheet: "src/index.css" },
];

const lf = (text) => text.replace(/\r\n/g, "\n");
const rulesOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const declaredNames = (css) =>
  new Set([...rulesOnly(lf(css)).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
const digest = (text) => createHash("sha256").update(lf(text)).digest("hex").slice(0, 12);

const shared = declaredNames(readFileSync(SOURCE, "utf8"));
const sourceDigest = digest(readFileSync(SOURCE, "utf8"));

function inspect(consumer) {
  const errors = [];
  let installed = null;
  try {
    const stylesheet = lf(readFileSync(join(consumer.dir, consumer.stylesheet), "utf8"));
    if (!rulesOnly(stylesheet).includes(IMPORT_LINE)) {
      errors.push(`${consumer.stylesheet} does not carry \`${IMPORT_LINE}\``);
    }
    const local = [...declaredNames(stylesheet)].filter((name) => shared.has(name));
    if (local.length > 0) {
      errors.push(`${consumer.stylesheet} re-declares shared tokens locally: ${local.join(", ")}`);
    }
    const installedPath = join(consumer.dir, "node_modules", PACKAGE, "dist", "tokens.css");
    if (!existsSync(installedPath)) {
      errors.push(`no installed sheet at ${installedPath} — re-pin to a SHA that ships it and \`npm ci\``);
    } else {
      installed = digest(readFileSync(installedPath, "utf8"));
    }
  } catch (error) {
    errors.push(`unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...consumer, errors, installed };
}

const results = CONSUMERS.map(inspect);

for (const result of results) {
  for (const error of result.errors) console.error(`FAIL ${result.name}: ${error}`);
}

const digests = new Set(results.map((r) => r.installed).filter(Boolean));
const failed = results.some((r) => r.errors.length > 0);

if (!failed && digests.size === 1) {
  const [installed] = digests;
  const lag = installed === sourceDigest ? "matches this checkout" : `this checkout is ${sourceDigest} (apps lag main)`;
  console.log(`OK: all ${results.length} consumers import ${PACKAGE}/tokens.css and install sheet ${installed} — ${lag}`);
  process.exit(0);
}
if (digests.size > 1) {
  console.error("FAIL: the consumers have different token sheets installed:");
  for (const result of results) console.error(`  ${result.name}: ${result.installed ?? "(none)"}`);
}
process.exit(1);
