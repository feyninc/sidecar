/** Static Sidecar config extraction for build manifests. */
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type ObjectLiteralExpression,
} from "ts-morph";
import { resolveDefaultExportCall, unwrapExpression } from "./ast.js";
import { createProject } from "./project.js";
import type { SidecarCompilerConfig } from "./types.js";
import { existsSyncSafe } from "./utils.js";

/** Reads the serializable subset of `sidecar.config.ts` without executing app code. */
export function analyzeProjectConfig(rootDir: string): SidecarCompilerConfig {
  const configPath = path.join(rootDir, "sidecar.config.ts");
  if (!existsSyncSafe(configPath)) {
    return defaultCompilerConfig();
  }

  const project = createProject(rootDir);
  const sourceFile = project.addSourceFileAtPath(configPath);
  const call = resolveDefaultExportCall(sourceFile, "defineConfig");
  const definition = unwrapExpression(call?.getArguments()[0]);
  if (!definition || !Node.isObjectLiteralExpression(definition)) {
    return defaultCompilerConfig();
  }

  return {
    resources: {
      subscribe: readBooleanNested(definition, "resources", "subscribe") ?? false,
      listChanged: readBooleanNested(definition, "resources", "listChanged") ?? false,
    },
    prompts: {
      listChanged: readBooleanNested(definition, "prompts", "listChanged") ?? false,
    },
    tools: {
      listChanged: readBooleanNested(definition, "tools", "listChanged") ?? false,
    },
    pagination: {
      pageSize: readNumberNested(definition, "pagination", "pageSize") ?? 10,
      hasOverride: hasProperty(readObjectProperty(definition, "pagination"), "override"),
    },
  };
}

/** Returns compiler defaults when config is absent. */
export function defaultCompilerConfig(): SidecarCompilerConfig {
  return {
    resources: {
      subscribe: false,
      listChanged: false,
    },
    prompts: {
      listChanged: false,
    },
    tools: {
      listChanged: false,
    },
    pagination: {
      pageSize: 10,
      hasOverride: false,
    },
  };
}

/** Reads a boolean nested object property. */
function readBooleanNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): boolean | undefined {
  const object = readObjectProperty(definition, section);
  if (!object) {
    return undefined;
  }
  const property = object.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  if (!initializer) {
    return undefined;
  }
  if (initializer.getKind() === SyntaxKind.TrueKeyword) return true;
  if (initializer.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** Reads a number nested object property. */
function readNumberNested(
  definition: ObjectLiteralExpression,
  section: string,
  propertyName: string,
): number | undefined {
  const object = readObjectProperty(definition, section);
  if (!object) {
    return undefined;
  }
  const property = object.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isNumericLiteral(initializer)
    ? Number(initializer.getLiteralText())
    : undefined;
}

/** Reads a nested object literal property. */
function readObjectProperty(
  definition: ObjectLiteralExpression,
  propertyName: string,
): ObjectLiteralExpression | undefined {
  const property = definition.getProperty(propertyName);
  if (!property || !Node.isPropertyAssignment(property)) {
    return undefined;
  }
  const initializer = unwrapExpression(property.getInitializer());
  return initializer && Node.isObjectLiteralExpression(initializer)
    ? initializer
    : undefined;
}

/** Returns true when an object literal has the named property. */
function hasProperty(
  definition: ObjectLiteralExpression | undefined,
  propertyName: string,
): boolean {
  return Boolean(definition?.getProperty(propertyName));
}
