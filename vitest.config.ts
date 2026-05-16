import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@sidecar/core": "/Users/shreyash/Code/sidecar/packages/core/src/index.ts",
      "@sidecar/compiler": "/Users/shreyash/Code/sidecar/packages/compiler/src/index.ts",
      "@sidecar/server": "/Users/shreyash/Code/sidecar/packages/server/src/index.ts"
    }
  }
});
