import { defineConfig } from "tsup";

/**
 * TWO builds, deliberately different shapes.
 *
 * ENGINES (bundled). esbuild resolves the `@/*` tsconfig path alias at build
 * time and emits real relative specifiers, so the published package carries no
 * alias dependency.
 *
 * UI (UNBUNDLED). `bundle: false` is load-bearing and not a style choice.
 * `Sheet` and `EvidenceDrawer` carry a `"use client"` directive; every other
 * primitive is a server component. Bundling the kit into one `ui.js` would
 * force a single answer for all twelve — either the directive is dropped and
 * the two client components break under the Next 15 App Router, or it is
 * hoisted to the whole file and a `<Card>` in a server page starts shipping
 * client JS. Transpiling file-by-file keeps the directive attached to the two
 * modules that declared it, which is exactly the granularity React Server
 * Components resolve at. Asserted, not assumed:
 * `tests/unit/ui/build-output.test.ts` reads the built files back.
 *
 * NEITHER build cleans. tsup runs an exported array CONCURRENTLY, so a
 * `clean: true` on one config races the other's output — it deleted the UI
 * declarations on the second run of this exact config while leaving the first
 * run intact, which is the worst possible failure mode for a build step. The
 * wipe is a separate `npm run clean` that finishes before tsup starts.
 */

const UI_EXTERNAL = ["react", "react-dom", "react/jsx-runtime", "lucide-react"];

export default defineConfig([
  {
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
    clean: false,
    sourcemap: true,
    treeshake: true,
  },
  {
    /*
     * Entries are rooted at `src/`, so the output mirrors the source tree:
     * `dist/components/ui/Sheet.js`, `dist/lib/utils/cn.js`. The kit's imports
     * are relative for the same reason — with `bundle: false` esbuild never
     * resolves the `@/*` alias, it just copies the specifier through.
     */
    entry: ["src/components/ui/*.ts", "src/components/ui/*.tsx", "src/lib/utils/cn.ts"],
    outDir: "dist",
    bundle: false,
    format: ["esm"],
    dts: true,
    clean: false,
    sourcemap: true,
    external: UI_EXTERNAL,
  },
]);
