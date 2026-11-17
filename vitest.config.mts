import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Next.js provides this guard at build time; in tests server modules run in Node directly
      "server-only": path.resolve(import.meta.dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
  test: {
    globalSetup: ["tests/setup/global-db.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
