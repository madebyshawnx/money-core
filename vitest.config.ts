import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the apps' alias so the copied tests run unmodified.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    /*
     * jsdom, not node: the engines never needed a DOM but the UI kit does, and
     * a per-file `@vitest-environment` pragma is the kind of thing that gets
     * forgotten on the thirteenth component. The engines are pure functions and
     * do not care which environment they run in.
     */
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    /*
     * X1 (session-18 QA audit): this package had zero coverage tooling of any
     * kind — for the money math all three apps depend on. Thresholds start at
     * the measured floor minus a small margin (ratchet UP as coverage grows,
     * never down): `npm run test:coverage` fails if coverage falls below them,
     * which makes "a new module landed with no tests" a loud event instead of
     * a silent one. CI does not gate on this yet (X1 says start informational);
     * the thresholds still protect anyone who runs it.
     */
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/components/**", "src/lib/seed/**"],
      /*
       * Measured 2026-08-20: statements 88.06 / branches 81.66 / functions
       * 85.97 / lines 89.95. Thresholds sit ~3 points under the measured
       * floor so the gate is green on arrival and catches regressions, not
       * normal variance.
       */
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 83,
        lines: 87,
      },
    },
  },
});
