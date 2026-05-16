import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SidecarToolManifestEntry } from "./types.js";
import { toIdentifier, toImportSpecifier } from "./utils.js";

export async function writeGeneratedTypes(
  rootDir: string,
  tools: SidecarToolManifestEntry[],
): Promise<void> {
  const generatedDir = path.join(rootDir, ".sidecar", "generated");
  await mkdir(generatedDir, { recursive: true });

  const imports = tools
    .map(
      (entry, index) =>
        `import type tool${index} from ${JSON.stringify(toImportSpecifier(generatedDir, path.join(rootDir, entry.sourceFile), { extension: "js" }))};`,
    )
    .join("\n");
  const ids = tools
    .map((entry) => `  ${toIdentifier(entry.id)}: ${JSON.stringify(entry.id)}`)
    .join(",\n");
  const toolTypes = tools
    .map(
      (entry, index) =>
        `  ${toIdentifier(entry.id)}(params: ToolParams<typeof tool${index}>): Promise<ToolOutput<typeof tool${index}>>;`,
    )
    .join("\n");

  await writeFile(
    path.join(generatedDir, "tools.ts"),
    `${imports}
import { createToolClient } from "@sidecar/client";

type ExecuteOf<T> = T extends { execute: infer Execute } ? Execute : never;
type ToolParams<T> = ExecuteOf<T> extends (params: infer Params, ...args: any[]) => unknown ? Params : never;
type RawToolOutput<T> = Awaited<ReturnType<Extract<ExecuteOf<T>, (...args: any[]) => unknown>>>;
type ToolOutput<T> = RawToolOutput<T> extends { structuredContent?: infer Structured } ? Structured : RawToolOutput<T>;

export const toolIds = {
${ids}
} as const;

export type WidgetTools = {
${toolTypes}
};

export const tools = createToolClient<WidgetTools>(toolIds);
`,
  );
}
