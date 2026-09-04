import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
