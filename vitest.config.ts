import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    exclude: ["node_modules", "dist"],
  },
});
