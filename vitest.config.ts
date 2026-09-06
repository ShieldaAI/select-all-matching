import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/core/**/*.test.ts", "tests/server/**/*.test.ts"],
    coverage: {
      all: true,
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text"],
      thresholds: {
        branches: 85,
        functions: 95,
        lines: 90,
        statements: 90,
      },
    },
  },
});
