import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
  },
  resolve: {
    alias: {
      "@impactmap/graph": path.resolve("packages/graph/src/index.ts"),
      "@impactmap/config": path.resolve("packages/config/src/index.ts"),
      "@impactmap/parsers": path.resolve("packages/parsers/src/index.ts"),
      "@impactmap/core": path.resolve("packages/core/src/index.ts"),
      "@impactmap/github": path.resolve("packages/github/src/index.ts"),
      "@impactmap/cli": path.resolve("packages/cli/src/index.ts"),
    },
  },
});
