#!/usr/bin/env node
/**
 * Restore the @emnapi lockfile entries that `npm install` on Windows prunes.
 *
 * The trap, measured across all three consumers during the 2026-08-15 v0.4.0
 * re-pin: regenerating a lockfile for a pin bump pruned @emnapi package
 * entries every single time — money-manager 25→20 occurrences, cadence 31→23
 * (including the two nested under @tailwindcss/oxide-wasm32-wasi), pennybank
 * 12→9 — while `npm ci` never rewrites the file at all. The consumers'
 * committed lockfiles carry the entries, so a pruned regen shows up as noisy
 * lockfile churn in every re-pin diff and as drift from what CI installs.
 *
 * This makes the restoration MECHANICAL instead of a hand ritual: a JSON
 * round-trip from the committed lockfile (never text patching), copying only
 * missing `@emnapi/` keys, then printing counts so the operator VERIFIES the
 * baseline was reached rather than assuming it.
 *
 * Run it after any `npm install` that rewrote a consumer's lockfile:
 *
 *   node scripts/restore-emnapi.mjs C:/dev/money-manager
 *   node scripts/restore-emnapi.mjs C:/dev/money_app
 *   node scripts/restore-emnapi.mjs C:/dev/pennybank-app
 *
 * It lives HERE, beside check-consumer-pins.mjs, because the trap fires on
 * exactly the same occasion that script polices: a money-core re-pin. Like
 * that script, it is operator tooling for the sibling working trees, not CI.
 *
 * NOTE — R2-11 (MASTER_BACKLOG) still owns the open DECISION about this guard:
 * R2-2 produced evidence that a Linux/npm-11 lockfile legitimately carries
 * ZERO @emnapi entries (they were hoisted duplicates of bundleDependencies),
 * so the durable answer may be to retire the convention rather than keep
 * restoring it. Until that decision is made with a container `npm ci` check,
 * this script keeps the committed baseline stable so the choice stays a
 * choice instead of an accident.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) {
  console.error("usage: node scripts/restore-emnapi.mjs <consumerRepoDir>");
  process.exit(1);
}

const lockPath = join(repo, "package-lock.json");
const committed = JSON.parse(
  execFileSync("git", ["-C", repo, "show", "HEAD:package-lock.json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const currentText = readFileSync(lockPath, "utf8");
const current = JSON.parse(currentText);
// Preserve the working copy's line endings: writing LF over a CRLF checkout
// leaves a content-identical but status-dirty file, which reads as churn.
const eol = currentText.includes("\r\n") ? "\r\n" : "\n";

let restored = 0;
for (const section of ["packages", "dependencies"]) {
  const from = committed[section];
  const into = current[section];
  if (!from || !into) continue;
  for (const key of Object.keys(from)) {
    if (!key.includes("@emnapi/")) continue;
    if (!(key in into)) {
      into[key] = from[key];
      restored += 1;
      console.log(`restored [${section}] ${key}`);
    }
  }
}

writeFileSync(lockPath, JSON.stringify(current, null, 2).replaceAll("\n", eol) + eol);
const text = readFileSync(lockPath, "utf8");
const count = (text.match(/@emnapi/g) ?? []).length;
const committedCount = (
  execFileSync("git", ["-C", repo, "show", "HEAD:package-lock.json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).match(/@emnapi/g) ?? []
).length;

console.log(`restored entries: ${restored}; @emnapi occurrences now ${count}, committed baseline ${committedCount}`);
if (count !== committedCount) {
  console.error("MISMATCH: working lockfile does not match the committed baseline — inspect the diff before committing.");
  process.exit(1);
}
