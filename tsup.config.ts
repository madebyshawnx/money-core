import { defineConfig } from "tsup";

/**
 * esbuild resolves the `@/*` tsconfig path alias at build time and emits real
 * relative specifiers, so the published package carries no alias dependency.
 *
 * The alias is why the sources here are BYTE-IDENTICAL to the copies still in
 * the apps: nothing had to be rewritten to extract them, so during the migration
 * a plain `diff` proves the package and the apps have not diverged.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    ledger: "src/lib/domain/ledger/index.ts",
    recurring: "src/lib/domain/recurring/index.ts",
    forecast: "src/lib/domain/forecast/index.ts",
    rules: "src/lib/domain/rules/index.ts",
    policy: "src/lib/domain/policy/validate.ts",
    types: "src/lib/domain/types.ts",
    money: "src/lib/utils/money.ts",
    seed: "src/lib/seed/scenarios.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
