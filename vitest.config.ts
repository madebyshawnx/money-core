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
  },
});
