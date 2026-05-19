import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const fromRoot = (...segments: string[]) => path.resolve(repoRoot, ...segments);

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"]
  },
  resolve: {
    alias: [
      { find: "sidecar-ai", replacement: fromRoot("packages/sidecar-ai/src/index.ts") },
      { find: "@sidecar-ai/anthropic/components", replacement: fromRoot("packages/anthropic/src/components.tsx") },
      { find: "@sidecar-ai/anthropic/plugin", replacement: fromRoot("packages/anthropic/src/plugin.ts") },
      { find: "@sidecar-ai/anthropic/hooks", replacement: fromRoot("packages/anthropic/src/hooks.ts") },
      { find: "@sidecar-ai/anthropic/agent", replacement: fromRoot("packages/anthropic/src/agent.ts") },
      { find: "@sidecar-ai/anthropic/command", replacement: fromRoot("packages/anthropic/src/command.ts") },
      { find: "@sidecar-ai/anthropic/mcp", replacement: fromRoot("packages/anthropic/src/mcp.ts") },
      { find: "@sidecar-ai/anthropic/skill", replacement: fromRoot("packages/anthropic/src/skill.ts") },
      { find: "@sidecar-ai/native/components", replacement: fromRoot("packages/native/src/components/index.tsx") },
      { find: "@sidecar-ai/native/styles.css", replacement: fromRoot("packages/native/src/styles.css") },
      { find: "@sidecar-ai/openai/components", replacement: fromRoot("packages/openai/src/components.tsx") },
      { find: "@sidecar-ai/openai/official", replacement: fromRoot("packages/openai/src/official.ts") },
      { find: "@sidecar-ai/server/proxy", replacement: fromRoot("packages/server/src/proxy.ts") },
      { find: "@sidecar-ai/anthropic", replacement: fromRoot("packages/anthropic/src/index.ts") },
      { find: "@sidecar-ai/openai", replacement: fromRoot("packages/openai/src/index.ts") },
      { find: "@sidecar-ai/client", replacement: fromRoot("packages/client/src/index.ts") },
      { find: "@sidecar-ai/core", replacement: fromRoot("packages/core/src/index.ts") },
      { find: "@sidecar-ai/auth", replacement: fromRoot("packages/auth/src/index.ts") },
      { find: "@sidecar-ai/compiler", replacement: fromRoot("packages/compiler/src/index.ts") },
      { find: "@sidecar-ai/server", replacement: fromRoot("packages/server/src/index.ts") },
      { find: "@sidecar-ai/react", replacement: fromRoot("packages/react/src/index.ts") },
      { find: "@sidecar-ai/native", replacement: fromRoot("packages/native/src/index.ts") }
    ]
  }
});
