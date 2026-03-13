import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace package to source so tests work without building first
      "agent-audit-trail": path.resolve(
        import.meta.dirname,
        "packages/core/src/index.ts",
      ),
    },
  },
  test: {
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 70,
        branches: 70,
        functions: 70,
        statements: 70,
      },
      include: ["packages/*/src/**/*.ts", "extensions/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
