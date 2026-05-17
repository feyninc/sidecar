import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: [
      { find: "sidecar-ai", replacement: "/Users/shreyash/Code/sidecar/packages/sidecar-ai/src/index.ts" },
      { find: "@sidecar-ai/native/components", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/components/index.tsx" },
      { find: "@sidecar-ai/native/styles.css", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/styles.css" },
      { find: "@sidecar-ai/anthropic/plugin", replacement: "/Users/shreyash/Code/sidecar/packages/anthropic/src/plugin.ts" },
      { find: "@sidecar-ai/anthropic/hooks", replacement: "/Users/shreyash/Code/sidecar/packages/anthropic/src/hooks.ts" },
      { find: "@sidecar-ai/client", replacement: "/Users/shreyash/Code/sidecar/packages/client/src/index.ts" },
      { find: "@sidecar-ai/core", replacement: "/Users/shreyash/Code/sidecar/packages/core/src/index.ts" },
      { find: "@sidecar-ai/auth", replacement: "/Users/shreyash/Code/sidecar/packages/auth/src/index.ts" },
      { find: "@sidecar-ai/compiler", replacement: "/Users/shreyash/Code/sidecar/packages/compiler/src/index.ts" },
      { find: "@sidecar-ai/server", replacement: "/Users/shreyash/Code/sidecar/packages/server/src/index.ts" },
      { find: "@sidecar-ai/react", replacement: "/Users/shreyash/Code/sidecar/packages/react/src/index.ts" },
      { find: "@sidecar-ai/native", replacement: "/Users/shreyash/Code/sidecar/packages/native/src/index.ts" }
    ]
  }
});
