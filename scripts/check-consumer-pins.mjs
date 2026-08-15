#!/usr/bin/env node
/**
 * MC-3 — assert the three consumers pin the SAME money-core SHA.
 *
 * Re-pinning is a manual three-repo edit, and the one hand-maintained record
 * of it has already been wrong once (R2-13 claimed `d27838d`; all three
 * actually pinned `1ded53e`, one commit older). This script replaces that
 * record with a measurement: it does not care WHICH SHA the apps pin — a
 * deliberate lag behind main is fine — only that they pin the SAME one,
 * because a split pin means two apps are running different shared engines
 * while every document says they cannot.
 *
 * Operator script, not CI: it reads the sibling working trees on the dev
 * machine (the repos are private and the consumers' Actions cannot install
 * a private git dependency anyway). Run it after any re-pin, and before
 * believing any statement about which engine version the apps share:
 *
 *   node scripts/check-consumer-pins.mjs
 *
 * Exit 0 with the shared SHA on match; exit 1 naming each repo's pin on
 * drift or on a missing/unpinned consumer.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = "@madebyshawnx/money-core";
const CONSUMERS = [
  { name: "money-manager", dir: "C:/dev/money-manager" },
  { name: "cadence (money_app)", dir: "C:/dev/money_app" },
  { name: "pennybank", dir: "C:/dev/pennybank-app" },
];

function pinOf(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const spec = manifest.dependencies?.[PACKAGE] ?? manifest.devDependencies?.[PACKAGE];
  if (!spec) return { error: `does not depend on ${PACKAGE}` };
  const sha = /#([0-9a-f]{7,40})$/.exec(spec)?.[1];
  if (!sha) return { error: `pin is not a SHA: ${spec}` };
  return { sha };
}

const results = CONSUMERS.map((consumer) => {
  try {
    return { ...consumer, ...pinOf(consumer.dir) };
  } catch (error) {
    return { ...consumer, error: `unreadable: ${error instanceof Error ? error.message : String(error)}` };
  }
});

const failures = results.filter((result) => result.error);
for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.error}`);

const shas = new Set(results.filter((result) => result.sha).map((result) => result.sha));
if (failures.length === 0 && shas.size === 1) {
  console.log(`OK: all ${results.length} consumers pin ${[...shas][0]}`);
  process.exit(0);
}
if (shas.size > 1) {
  console.error("FAIL: consumer pins have drifted apart:");
  for (const result of results) console.error(`  ${result.name}: ${result.sha ?? result.error}`);
}
process.exit(1);
