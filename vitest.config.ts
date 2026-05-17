import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: [
      { find: "@sidecar/native/components", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/components/index.tsx" },
      { find: "@sidecar/native/styles.css", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/styles.css" },
      { find: "@sidecar/anthropic/plugin", replacement: "/Users/shreyash/Code/sidecar/packages/anthropic/src/plugin.ts" },
      { find: "@sidecar/anthropic/hooks", replacement: "/Users/shreyash/Code/sidecar/packages/anthropic/src/hooks.ts" },
      { find: "@sidecar/client", replacement: "/Users/shreyash/Code/sidecar/packages/client/src/index.ts" },
      { find: "@sidecar/core", replacement: "/Users/shreyash/Code/sidecar/packages/core/src/index.ts" },
      { find: "@sidecar/auth", replacement: "/Users/shreyash/Code/sidecar/packages/auth/src/index.ts" },
      { find: "@sidecar/compiler", replacement: "/Users/shreyash/Code/sidecar/packages/compiler/src/index.ts" },
      { find: "@sidecar/server", replacement: "/Users/shreyash/Code/sidecar/packages/server/src/index.ts" },
      { find: "@sidecar/react", replacement: "/Users/shreyash/Code/sidecar/packages/react/src/index.ts" },
      { find: "@sidecar/native", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/index.ts" }
    ]
  }
});
