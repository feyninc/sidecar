import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "core/index": "packages/core/src/index.ts",
    "client/index": "packages/client/src/index.ts",
    "auth/index": "packages/auth/src/index.ts",
    "anthropic/index": "packages/anthropic/src/index.ts",
    "anthropic/agent": "packages/anthropic/src/agent.ts",
    "anthropic/command": "packages/anthropic/src/command.ts",
    "anthropic/hooks": "packages/anthropic/src/hooks.ts",
    "anthropic/mcp": "packages/anthropic/src/mcp.ts",
    "anthropic/plugin": "packages/anthropic/src/plugin.ts",
    "anthropic/skill": "packages/anthropic/src/skill.ts",
    "compiler/index": "packages/compiler/src/index.ts",
    "server/index": "packages/server/src/index.ts",
    "server/proxy": "packages/server/src/proxy.ts",
    "cli/index": "packages/cli/src/index.ts",
    "create-sidecar-app/index": "packages/create-sidecar-app/src/index.ts",
    "openai/index": "packages/openai/src/index.ts",
    "react/index": "packages/react/src/index.ts",
    "native/index": "packages/native/src/index.ts",
    "native/components": "packages/native/src/components/index.tsx"
  },
  clean: true,
  dts: true,
  external: ["tsx", "ts-morph", "typescript", "@ts-morph/common", "esbuild", "react", "react-dom", "zod"],
  format: ["esm"],
  minify: false,
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "node20"
});
