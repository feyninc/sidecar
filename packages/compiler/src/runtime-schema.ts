/** Runtime schema extraction for validators that can describe themselves. */
import { isSidecarTool, type JsonSchema, type SidecarTool } from "@sidecar-ai/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import { existsSyncSafe } from "./utils.js";

type RuntimeModule = {
  default?: unknown;
};

type JsonSchemaConverter = (
  options?: { io?: "input" | "output" },
) => unknown;

type ZodTopLevelModule = {
  toJSONSchema?: (schema: unknown, options?: { io?: "input" | "output" }) => unknown;
};

/** Imports a Sidecar tool and converts its runtime params validator into JSON Schema when possible. */
export async function readRuntimeToolInputSchema(
  rootDir: string,
  sourcePath: string,
): Promise<JsonSchema | undefined> {
  let sidecarTool: SidecarTool | undefined;
  try {
    sidecarTool = await importRuntimeTool(rootDir, sourcePath);
  } catch (error) {
    warnRuntimeSchemaFallback(sourcePath, error);
    return undefined;
  }

  if (!sidecarTool.params) {
    return undefined;
  }

  try {
    return await paramsToJsonSchema(sidecarTool.params);
  } catch (error) {
    warnRuntimeSchemaFallback(sourcePath, error);
    return undefined;
  }
}

/** Loads one authored `tool.ts` through tsx so runtime schemas can be inspected. */
async function importRuntimeTool(
  rootDir: string,
  sourcePath: string,
): Promise<SidecarTool> {
  const module = (await tsImport(pathToFileURL(sourcePath).href, {
    parentURL: runtimeParentUrl(rootDir),
    tsconfig: runtimeTsconfig(rootDir),
  })) as RuntimeModule;

  const defaultExport = unwrapRuntimeDefault(module.default);
  if (!isSidecarTool(defaultExport)) {
    throw new Error(`${path.relative(rootDir, sourcePath)} must default-export tool({ ... }).`);
  }

  return defaultExport;
}

/** Converts Zod v4 classic/mini schemas without Sidecar parsing Zod source code. */
async function paramsToJsonSchema(params: unknown): Promise<JsonSchema | undefined> {
  const instanceConverter = readInstanceConverter(params);
  if (instanceConverter) {
    return ensureJsonSchema(instanceConverter({ io: "input" }));
  }

  if (isZodMiniSchema(params)) {
    const zod = (await import("zod/v4-mini")) as ZodTopLevelModule;
    if (typeof zod.toJSONSchema === "function") {
      return ensureJsonSchema(zod.toJSONSchema(params, { io: "input" }));
    }
  }

  return undefined;
}

/** Reads the v4 classic instance method. The lowercase variant is accepted defensively. */
function readInstanceConverter(params: unknown): JsonSchemaConverter | undefined {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const record = params as Record<string, unknown>;
  const converter = record.toJSONSchema ?? record.toJsonSchema;
  return typeof converter === "function"
    ? converter.bind(params) as JsonSchemaConverter
    : undefined;
}

/** Returns true for Zod Mini schemas, which rely on top-level conversion helpers. */
function isZodMiniSchema(params: unknown): boolean {
  return Boolean(params && typeof params === "object" && "_zod" in params);
}

/** Narrows Zod's unknown converter output to the object shape MCP descriptors require. */
function ensureJsonSchema(value: unknown): JsonSchema | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as JsonSchema;
}

/** Builds a stable parent URL for tsx module resolution. */
function runtimeParentUrl(rootDir: string): string {
  const configPath = path.join(rootDir, "sidecar.config.ts");
  return pathToFileURL(existsSync(configPath) ? configPath : rootDir).href;
}

/** Uses the app tsconfig, with a repo-local fallback for compiler tests and examples. */
function runtimeTsconfig(rootDir: string): string | false {
  const projectTsconfig = path.join(rootDir, "tsconfig.json");
  if (existsSync(projectTsconfig)) {
    return projectTsconfig;
  }

  const repoTsconfig = path.join(process.cwd(), "tsconfig.json");
  const repoCore = path.join(process.cwd(), "packages", "core", "src", "index.ts");
  return existsSyncSafe(repoTsconfig) && existsSyncSafe(repoCore) ? repoTsconfig : false;
}

/** Normalizes default-export interop shapes produced by source TypeScript loaders. */
function unwrapRuntimeDefault(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "default" in value &&
    Object.keys(value).every((key) => key === "default" || key === "__esModule")
  ) {
    return unwrapRuntimeDefault((value as { default: unknown }).default);
  }
  return value;
}

/** Keeps runtime schema import problems visible without breaking TS fallback analysis. */
function warnRuntimeSchemaFallback(sourcePath: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(
    `[sidecar] Could not convert runtime params schema for ${sourcePath}; falling back to TypeScript parameter inference. ${message}`,
  );
}
