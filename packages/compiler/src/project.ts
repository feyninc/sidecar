/** Shared ts-morph project setup for Sidecar reserved-file analyzers. */
import path from "node:path";
import {
  ModuleKind,
  ModuleResolutionKind,
  Project,
  ScriptTarget,
} from "ts-morph";
import { existsSyncSafe } from "./utils.js";

/** Creates a ts-morph project using the app tsconfig when available. */
export function createProject(rootDir: string): Project {
  const tsconfig = path.join(rootDir, "tsconfig.json");

  return new Project({
    tsConfigFilePath: existsSyncSafe(tsconfig) ? tsconfig : undefined,
    compilerOptions: existsSyncSafe(tsconfig)
      ? undefined
      : {
          allowJs: false,
          baseUrl: process.cwd(),
          esModuleInterop: true,
          module: ModuleKind.NodeNext,
          moduleResolution: ModuleResolutionKind.NodeNext,
          paths: devSidecarTypePaths(),
          strict: true,
          target: ScriptTarget.ES2022,
        },
    skipAddingFilesFromTsConfig: true,
  });
}

/** Provides source aliases for repo-local examples before package dist exists. */
function devSidecarTypePaths(): Record<string, string[]> | undefined {
  const repoRoot = process.cwd();
  const corePath = path.join(repoRoot, "packages", "core", "src", "index.ts");
  if (!existsSyncSafe(corePath)) {
    return undefined;
  }

  return {
    "@sidecar/core": ["packages/core/src/index.ts"],
    "@sidecar/client": ["packages/client/src/index.ts"],
    "@sidecar/react": ["packages/react/src/index.ts"],
    "@sidecar/native": ["packages/native/src/index.ts"],
    "@sidecar/native/components": ["packages/native/src/components/index.tsx"],
    "@sidecar/openai": ["packages/openai/src/index.ts"],
    "@sidecar/openai/components": ["packages/openai/src/components.tsx"],
    "@sidecar/anthropic": ["packages/anthropic/src/index.ts"],
    "@sidecar/anthropic/components": ["packages/anthropic/src/components.tsx"],
    "@sidecar/anthropic/plugin": ["packages/anthropic/src/plugin.ts"],
    "@sidecar/anthropic/hooks": ["packages/anthropic/src/hooks.ts"],
  };
}
